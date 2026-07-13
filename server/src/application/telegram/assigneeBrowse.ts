// Меню /tasks «по ответственным» (spec 2026-07-13-unified-workspace §5): чистые билдеры
// текста+клавиатуры, без отправки в TG — отправляет HandleTelegramWebhook. Экран 1 —
// кнопки «👤 Имя (N)» по делегатам активных делегаций + «Без ответственного (N)» +
// «📁 По проектам» (существующая навигация bt:). Экран 2 — карточки задач ответственного.
import type { InlineKeyboardButton, InlineKeyboardMarkup } from './TelegramClient.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { TaskDelegationRepository } from '../task/TaskDelegationRepository.js';
import type { Task } from '../../domain/task/Task.js';
import type { TaskDelegation } from '../../domain/task/TaskDelegation.js';
import { taskActionKeyboard } from './taskActionKeyboard.js';
import {
  splitDescription,
  formatDeadlineRu,
  escapeHtml,
} from '../../domain/task/digestFormat.js';

// Узкие Pick'и от существующих портов — unit-тесты обходятся мини-фейками.
export type AssigneeBrowseDeps = {
  readonly members: Pick<ProjectMemberRepository, 'listProjectsForUser'>;
  readonly tasks: Pick<TaskRepository, 'listByProject'>;
  readonly delegations: Pick<TaskDelegationRepository, 'listActiveForTasks'>;
};

// Лимиты v1 без пагинации (симметрично BROWSE_LIMIT в HandleTelegramWebhook).
export const ASSIGNEE_MENU_LIMIT = 12;
export const ASSIGNEE_CARDS_LIMIT = 12;

export type AssigneeMenu = {
  readonly text: string;
  readonly keyboard: InlineKeyboardMarkup;
};

export type AssigneeTaskCard = {
  readonly taskId: string;
  readonly projectId: string;
  readonly text: string;
  readonly keyboard: InlineKeyboardMarkup;
};

export type AssigneeTaskCards = {
  // Имя ответственного (из делегации). null для режима «Без ответственного».
  readonly assigneeName: string | null;
  // Всего подходящих задач (до среза ASSIGNEE_CARDS_LIMIT).
  readonly totalCount: number;
  readonly cards: AssigneeTaskCard[];
};

type OpenTaskRow = {
  readonly task: Task;
  readonly projectId: string;
  readonly projectName: string;
};

// Все открытые (status !== 'done') задачи по всем проектам юзера + карта активных делегаций.
async function collectOpenTasks(
  deps: AssigneeBrowseDeps,
  userId: string,
): Promise<{ hasProjects: boolean; rows: OpenTaskRow[]; delegationByTask: Map<string, TaskDelegation> }> {
  const projects = await deps.members.listProjectsForUser(userId);
  if (projects.length === 0) {
    return { hasProjects: false, rows: [], delegationByTask: new Map() };
  }
  const rows: OpenTaskRow[] = [];
  for (const p of projects) {
    const tasks = await deps.tasks.listByProject(p.id);
    for (const t of tasks) {
      if (t.status !== 'done') rows.push({ task: t, projectId: p.id, projectName: p.name });
    }
  }
  const delegationByTask =
    rows.length > 0
      ? await deps.delegations.listActiveForTasks(rows.map((r) => r.task.id))
      : new Map<string, TaskDelegation>();
  return { hasProjects: true, rows, delegationByTask };
}

// Экран 1: «👤 Имя (N)» → ba:<userId>; «Без ответственного (N)» → ba:none;
// «📁 По проектам» → bt:root (обрабатывает существующий handleBrowseCallback, Task 17).
// null = у юзера нет проектов вообще (вызывающий шлёт свою «📭»-заглушку).
export async function buildAssigneeMenu(
  deps: AssigneeBrowseDeps,
  userId: string,
): Promise<AssigneeMenu | null> {
  const { hasProjects, rows, delegationByTask } = await collectOpenTasks(deps, userId);
  if (!hasProjects) return null;

  const byAssignee = new Map<string, { name: string; count: number }>();
  let noneCount = 0;
  for (const r of rows) {
    const d = delegationByTask.get(r.task.id) ?? null;
    if (!d) {
      // Без активной делегации ответственность за создателем — корзина «Без ответственного».
      noneCount += 1;
      continue;
    }
    const entry = byAssignee.get(d.delegateUserId);
    if (entry) entry.count += 1;
    else byAssignee.set(d.delegateUserId, { name: d.delegateDisplayName, count: 1 });
  }

  const assigneeButtons: InlineKeyboardButton[] = [...byAssignee.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, ASSIGNEE_MENU_LIMIT)
    .map(([uid, e]) => ({
      text: `👤 ${e.name.slice(0, 32)} (${e.count})`,
      callback_data: `ba:${uid}`,
    }));

  const keyboardRows: InlineKeyboardButton[][] = chunk2(assigneeButtons);
  if (noneCount > 0) {
    keyboardRows.push([{ text: `Без ответственного (${noneCount})`, callback_data: 'ba:none' }]);
  }
  keyboardRows.push([{ text: '📁 По проектам', callback_data: 'bt:root' }]);

  const overflowNote =
    byAssignee.size > ASSIGNEE_MENU_LIMIT
      ? `\n\n<i>Показаны первые ${ASSIGNEE_MENU_LIMIT} ответственных — остальные в интерфейсе.</i>`
      : '';
  const text =
    rows.length === 0
      ? '✨ Открытых задач нет.'
      : `👥 <b>Задачи по ответственным</b> — открытых: ${rows.length}${overflowNote}`;
  return { text, keyboard: { inline_keyboard: keyboardRows } };
}

// Разбивка кнопок по 2 в ряд (та же вёрстка, что в /tasks-браузере).
function chunk2<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += 2) out.push(items.slice(i, i + 2) as T[]);
  return out;
}

// Экран 2: карточки открытых задач выбранного ответственного в охвате viewerUserId.
// assigneeUserId === null → задачи без активной делегации («Без ответственного»).
// Сортировка: по сроку asc (просроченные оказываются первыми), задачи без срока — в конец.
export async function buildAssigneeTaskCards(
  deps: AssigneeBrowseDeps,
  viewerUserId: string,
  assigneeUserId: string | null,
  appUrl: string,
  now: Date = new Date(),
): Promise<AssigneeTaskCards> {
  const { rows, delegationByTask } = await collectOpenTasks(deps, viewerUserId);
  let assigneeName: string | null = null;
  const matching = rows.filter((r) => {
    const d = delegationByTask.get(r.task.id) ?? null;
    if (assigneeUserId === null) return d === null;
    if (d !== null && d.delegateUserId === assigneeUserId) {
      assigneeName = d.delegateDisplayName;
      return true;
    }
    return false;
  });
  // Node sort стабильный: внутри «просроченных»/«будущих» порядок по сроку, без срока — хвост.
  matching.sort((a, b) => {
    const da = a.task.deadline;
    const db = b.task.deadline;
    if (da !== null && db !== null) return da < db ? -1 : da > db ? 1 : 0;
    if (da !== null) return -1;
    if (db !== null) return 1;
    return 0;
  });

  const base = appUrl.replace(/\/$/, '');
  const cards = matching.slice(0, ASSIGNEE_CARDS_LIMIT).map((r): AssigneeTaskCard => {
    const title = splitDescription(r.task.description).name;
    const lines = [`📌 <b>${escapeHtml(title)}</b>`, `📁 ${escapeHtml(r.projectName)}`];
    if (r.task.deadline !== null) {
      const overdue = isOverdue(r.task.deadline, now);
      lines.push(`⏰ ${formatDeadlineRu(r.task.deadline, now)}${overdue ? ' · ❗️ просрочено' : ''}`);
    }
    const url = `${base}/projects/${r.projectId}?task=${r.task.id}`;
    return {
      taskId: r.task.id,
      projectId: r.projectId,
      text: lines.join('\n'),
      keyboard: {
        inline_keyboard: [
          ...taskActionKeyboard(r.task.id).inline_keyboard,
          [{ text: 'Открыть в ProjectsFlow', url }],
        ],
      },
    };
  });
  return { assigneeName, totalCount: matching.length, cards };
}

// 'YYYY-MM-DD' строго раньше сегодняшней даты (локальная TZ, как formatDeadlineRu).
function isOverdue(iso: string, now: Date): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return date.getTime() < today.getTime();
}
