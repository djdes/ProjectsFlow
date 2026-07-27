import type { Task } from '../../domain/task/Task.js';

// Чистая сборка модели ежедневной сводки руководителя: «кто над чем работает» по всему
// пространству + отдельная секция просрочек. Без БД и HTTP — рендер и подсчёты
// тестируются напрямую. См. docs/superpowers/specs/2026-07-27-lead-role-design.md §3.

export type LeadDigestTask = {
  readonly taskId: string;
  readonly title: string;
  readonly projectName: string;
  readonly assigneeName: string;
  readonly deadline: string | null;
};

export type LeadDigestGroup = {
  readonly userId: string;
  readonly displayName: string;
  readonly tasks: readonly LeadDigestTask[];
};

export type LeadDigestModel = {
  readonly workspaceName: string;
  readonly dateMsk: string;
  readonly activeCount: number;
  readonly groups: readonly LeadDigestGroup[];
  readonly overdue: readonly LeadDigestTask[];
};

export type BuildLeadDigestInput = {
  readonly workspaceName: string;
  readonly dateMsk: string;
  readonly tasks: readonly Task[];
  readonly projectNameById: ReadonlyMap<string, string>;
};

// Заголовок задачи — первая непустая строка описания (отдельного title в модели нет).
function taskTitle(description: string | null): string {
  const first = (description ?? '')
    .split('\n')
    .map((line) => line.replace(/^#+\s*/u, '').replace(/\*\*/gu, '').trim())
    .find((line) => line.length > 0);
  return first && first.length > 0 ? first : 'Без названия';
}

export function buildLeadDigest(input: BuildLeadDigestInput): LeadDigestModel {
  // Завершённые в сводку не идут: она отвечает на вопрос «что в работе», а не «что было».
  const active = input.tasks.filter((t) => t.status !== 'done');

  const toItem = (t: Task): LeadDigestTask => ({
    taskId: t.id,
    title: taskTitle(t.description),
    projectName: input.projectNameById.get(t.projectId) ?? 'Проект',
    assigneeName: t.assignee.displayName,
    deadline: t.deadline,
  });

  const byAssignee = new Map<string, { displayName: string; tasks: LeadDigestTask[] }>();
  for (const t of active) {
    const key = t.assignee.userId;
    const bucket = byAssignee.get(key) ?? { displayName: t.assignee.displayName, tasks: [] };
    bucket.tasks.push(toItem(t));
    byAssignee.set(key, bucket);
  }

  const groups = [...byAssignee.entries()]
    .map(([userId, bucket]) => ({
      userId,
      displayName: bucket.displayName,
      // Внутри человека — сначала с ближайшим сроком, задачи без срока в конце.
      tasks: [...bucket.tasks].sort((a, b) => {
        if (a.deadline === b.deadline) return a.title.localeCompare(b.title, 'ru');
        if (a.deadline === null) return 1;
        if (b.deadline === null) return -1;
        return a.deadline.localeCompare(b.deadline);
      }),
    }))
    // Самые загруженные — сверху: руководителю важнее, у кого затор.
    .sort((a, b) => b.tasks.length - a.tasks.length || a.displayName.localeCompare(b.displayName, 'ru'));

  const overdue = active
    .filter((t) => t.deadline !== null && t.deadline < input.dateMsk)
    .map(toItem)
    .sort((a, b) => (a.deadline ?? '').localeCompare(b.deadline ?? ''));

  return {
    workspaceName: input.workspaceName,
    dateMsk: input.dateMsk,
    activeCount: active.length,
    groups,
    overdue,
  };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}

// Сколько задач показываем на человека в Telegram: сообщение должно оставаться читаемым,
// полный список — на доске по ссылке.
const TG_TASKS_PER_PERSON = 5;
const TG_OVERDUE_LIMIT = 10;

export function renderLeadDigestTelegram(model: LeadDigestModel): string {
  const lines: string[] = [
    `📊 <b>Сводка по команде</b> · ${escapeHtml(model.workspaceName)}`,
    `Активных задач: <b>${model.activeCount}</b>`,
    '',
  ];

  if (model.groups.length === 0) {
    lines.push('<i>Активных задач нет.</i>');
  }

  for (const group of model.groups) {
    lines.push(`👤 <b>${escapeHtml(group.displayName)}</b> — ${group.tasks.length}`);
    for (const task of group.tasks.slice(0, TG_TASKS_PER_PERSON)) {
      const deadline = task.deadline ? ` · до ${escapeHtml(task.deadline)}` : '';
      lines.push(`• ${escapeHtml(task.title)} <i>(${escapeHtml(task.projectName)})</i>${deadline}`);
    }
    const rest = group.tasks.length - TG_TASKS_PER_PERSON;
    if (rest > 0) lines.push(`<i>…и ещё ${rest}</i>`);
    lines.push('');
  }

  if (model.overdue.length > 0) {
    lines.push(`⏰ <b>Просрочено: ${model.overdue.length}</b>`);
    for (const task of model.overdue.slice(0, TG_OVERDUE_LIMIT)) {
      lines.push(
        `• ${escapeHtml(task.title)} — ${escapeHtml(task.assigneeName)}, срок ${escapeHtml(task.deadline ?? '')}`,
      );
    }
    const rest = model.overdue.length - TG_OVERDUE_LIMIT;
    if (rest > 0) lines.push(`<i>…и ещё ${rest}</i>`);
  }

  return lines.join('\n').trim();
}
