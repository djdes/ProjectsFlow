// Per-project kanban board customization (column colors / renamed labels / hidden columns)
// plus the user-level global default color map.
//
// Shared project state: unlike per-member notification prefs (project_members.notification_prefs),
// kanban settings live on the `projects` row, so all members of a project see the same board look.

export const KANBAN_COLORS = [
  'default',
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const;
export type KanbanColor = (typeof KANBAN_COLORS)[number];

// Only the 4 visually-rendered columns are customizable. `in_progress`/`awaiting_clarification`
// render inside the `todo` column and are never separate columns.
export const VISIBLE_KANBAN_STATUSES = ['backlog', 'manual', 'todo', 'done'] as const;
export type VisibleKanbanStatus = (typeof VISIBLE_KANBAN_STATUSES)[number];

export type KanbanColumnSettings = {
  readonly color?: KanbanColor;
  readonly label?: string;
  readonly hidden?: boolean;
};

// projects.kanban_settings — sparse map (NULL / {} = built-in defaults).
export type KanbanBoardSettings = Partial<Record<VisibleKanbanStatus, KanbanColumnSettings>>;

// users.default_kanban_colors — per-status default color, a live fallback for all the user's
// projects (resolved at render time, NOT copied into a project on creation).
export type KanbanDefaultColors = Partial<Record<VisibleKanbanStatus, KanbanColor>>;

// Built-in defaults — Notion-ish pastel per column.
export const BUILTIN_KANBAN_COLORS: Record<VisibleKanbanStatus, KanbanColor> = {
  backlog: 'gray',
  manual: 'yellow',
  todo: 'blue',
  done: 'green',
};

// 3-tier resolution: per-project override → user global default → built-in.
// `'default'` is treated as "no explicit choice" so it falls through to the next tier.
export function resolveColumnColor(
  perProject: KanbanColumnSettings | undefined,
  userDefault: KanbanColor | undefined,
  status: VisibleKanbanStatus,
): KanbanColor {
  if (perProject?.color && perProject.color !== 'default') return perProject.color;
  if (userDefault && userDefault !== 'default') return userDefault;
  return BUILTIN_KANBAN_COLORS[status];
}

// Built-in column display labels (зеркало client/src/presentation/components/tasks/statusLabels.ts —
// держим в синхроне). Только 4 видимые колонки; in_progress/awaiting_clarification — не колонки.
// backlog = «ЧЕРНОВИКИ» (черновики/драфты), todo = «ВОРКЕР» (очередь Ralph-агента),
// manual = «В РУЧНУЮ» (человек), done = «Готово».
export const BUILTIN_KANBAN_LABELS: Record<VisibleKanbanStatus, string> = {
  backlog: 'ЧЕРНОВИКИ',
  manual: 'В РУЧНУЮ',
  todo: 'ВОРКЕР',
  done: 'Готово',
};

// Подпись колонки: per-project override (если задан непустой label) → built-in.
export function resolveColumnLabel(
  perProject: KanbanColumnSettings | undefined,
  status: VisibleKanbanStatus,
): string {
  const custom = perProject?.label?.trim();
  return custom && custom.length > 0 ? custom : BUILTIN_KANBAN_LABELS[status];
}

// Скрыта ли колонка на доске проекта (per-project hidden=true).
export function isColumnHidden(perProject: KanbanColumnSettings | undefined): boolean {
  return perProject?.hidden === true;
}
