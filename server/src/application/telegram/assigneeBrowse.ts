// Меню /tasks «по ответственным»: чистые билдеры текста+клавиатуры, без отправки
// в Telegram — отправляет HandleTelegramWebhook. Единственный источник ответственного —
// обязательное поле task.assignee.
import type { InlineKeyboardButton, InlineKeyboardMarkup } from './TelegramClient.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { Task } from '../../domain/task/Task.js';
import { taskActionKeyboard } from './taskActionKeyboard.js';
import { fuzzyMatch } from './composer/fuzzyMatch.js';
import {
  splitDescription,
  formatDeadlineRu,
  escapeHtml,
} from '../../domain/task/digestFormat.js';

// Узкие Pick'и от существующих портов — unit-тесты обходятся мини-фейками.
export type AssigneeBrowseDeps = {
  readonly members: Pick<ProjectMemberRepository, 'listProjectsForUser'>;
  readonly tasks: Pick<TaskRepository, 'listByProject'>;
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
  // null означает, что задачи выбранного ответственного уже не существуют в охвате viewer.
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

// Все открытые (status !== 'done') задачи по всем проектам пользователя.
async function collectOpenTasks(
  deps: AssigneeBrowseDeps,
  userId: string,
): Promise<{ hasProjects: boolean; rows: OpenTaskRow[] }> {
  const projects = await deps.members.listProjectsForUser(userId);
  if (projects.length === 0) {
    return { hasProjects: false, rows: [] };
  }
  const rows: OpenTaskRow[] = [];
  for (const p of projects) {
    const tasks = await deps.tasks.listByProject(p.id);
    for (const t of tasks) {
      if (t.status !== 'done') rows.push({ task: t, projectId: p.id, projectName: p.name });
    }
  }
  return { hasProjects: true, rows };
}

// Экран 1: «👤 Имя (N)» → ba:<userId>; «📁 По проектам» → bt:root.
// null = у юзера нет проектов вообще (вызывающий шлёт свою «📭»-заглушку).
export async function buildAssigneeMenu(
  deps: AssigneeBrowseDeps,
  userId: string,
): Promise<AssigneeMenu | null> {
  const { hasProjects, rows } = await collectOpenTasks(deps, userId);
  if (!hasProjects) return null;

  const byAssignee = new Map<string, { name: string; count: number }>();
  for (const r of rows) {
    const { userId: assigneeUserId, displayName } = r.task.assignee;
    const entry = byAssignee.get(assigneeUserId);
    if (entry) entry.count += 1;
    else byAssignee.set(assigneeUserId, { name: displayName, count: 1 });
  }

  const assigneeButtons: InlineKeyboardButton[] = [...byAssignee.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, ASSIGNEE_MENU_LIMIT)
    .map(([uid, e]) => ({
      text: `👤 ${e.name.slice(0, 32)} (${e.count})`,
      callback_data: `ba:${uid}`,
    }));

  const keyboardRows: InlineKeyboardButton[][] = chunk2(assigneeButtons);
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

// Резолв «@Человек» (из TG-упоминания) → конкретный ответственный. Кандидаты — только те,
// у кого ЕСТЬ открытые задачи в проектах viewer'а (о ком вообще есть что показать). Матч —
// fuzzyMatch по displayName (exact → prefix → substring), тот же приём, что в композере.
export type AssigneeResolution =
  | { readonly kind: 'ok'; readonly assigneeUserId: string; readonly assigneeName: string }
  | { readonly kind: 'none' } // query не сматчился ни с кем
  | { readonly kind: 'ambiguous'; readonly options: { userId: string; name: string; count: number }[] }
  | { readonly kind: 'no_projects' }; // у viewer'а нет проектов с открытыми задачами

export async function resolveAssigneeByName(
  deps: AssigneeBrowseDeps,
  viewerUserId: string,
  query: string,
): Promise<AssigneeResolution> {
  const { hasProjects, rows } = await collectOpenTasks(deps, viewerUserId);
  if (!hasProjects || rows.length === 0) return { kind: 'no_projects' };

  const byAssignee = new Map<string, { name: string; count: number }>();
  for (const r of rows) {
    const { userId, displayName } = r.task.assignee;
    const e = byAssignee.get(userId);
    if (e) e.count += 1;
    else byAssignee.set(userId, { name: displayName, count: 1 });
  }
  const candidates = [...byAssignee.entries()].map(([userId, e]) => ({
    userId,
    name: e.name,
    count: e.count,
  }));

  const res = fuzzyMatch(query, candidates, (c) => c.name);
  if (res.unique) {
    return { kind: 'ok', assigneeUserId: res.unique.userId, assigneeName: res.unique.name };
  }
  if (res.matches.length === 0) return { kind: 'none' };
  return { kind: 'ambiguous', options: res.matches.slice(0, ASSIGNEE_MENU_LIMIT).map((m) => ({ ...m })) };
}

// Разбивка кнопок по 2 в ряд (та же вёрстка, что в /tasks-браузере).
function chunk2<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += 2) out.push(items.slice(i, i + 2) as T[]);
  return out;
}

// Экран 2: карточки открытых задач выбранного ответственного в охвате viewerUserId.
// Сортировка: по сроку asc (просроченные оказываются первыми), задачи без срока — в конец.
export async function buildAssigneeTaskCards(
  deps: AssigneeBrowseDeps,
  viewerUserId: string,
  assigneeUserId: string,
  appUrl: string,
  now: Date = new Date(),
): Promise<AssigneeTaskCards> {
  const { rows } = await collectOpenTasks(deps, viewerUserId);
  const matching = rows.filter((r) => r.task.assignee.userId === assigneeUserId);
  const assigneeName = matching[0]?.task.assignee.displayName ?? null;
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
