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
