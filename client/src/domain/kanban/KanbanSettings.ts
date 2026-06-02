// Per-project kanban board customization (column colors / renamed labels / hidden columns)
// plus the user-level global default color map. Mirror of the server domain
// (server/src/domain/kanban/KanbanSettings.ts) — shared project state, resolved live in UI.

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
// render inside the `todo` column and are never separate columns. These literals are also
// valid `TaskStatus` values, so a VisibleKanbanStatus is assignable to TaskStatus.
export const VISIBLE_KANBAN_STATUSES = ['backlog', 'manual', 'todo', 'done'] as const;
export type VisibleKanbanStatus = (typeof VISIBLE_KANBAN_STATUSES)[number];

export type KanbanColumnSettings = {
  readonly color?: KanbanColor;
  readonly label?: string;
  readonly hidden?: boolean;
};

export type KanbanBoardSettings = Partial<Record<VisibleKanbanStatus, KanbanColumnSettings>>;
export type KanbanDefaultColors = Partial<Record<VisibleKanbanStatus, KanbanColor>>;

// Built-in defaults — Notion-ish pastel per column.
export const BUILTIN_KANBAN_COLORS: Record<VisibleKanbanStatus, KanbanColor> = {
  backlog: 'gray',
  manual: 'yellow',
  todo: 'blue',
  done: 'green',
};

export function isVisibleKanbanStatus(s: string): s is VisibleKanbanStatus {
  return (VISIBLE_KANBAN_STATUSES as readonly string[]).includes(s);
}

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

// Renamed header → falls back to the built-in label when unset or blank.
export function resolveColumnLabel(
  perProject: KanbanColumnSettings | undefined,
  builtinLabel: string,
): string {
  const custom = perProject?.label?.trim();
  return custom && custom.length > 0 ? perProject!.label! : builtinLabel;
}

export function isColumnHidden(perProject: KanbanColumnSettings | undefined): boolean {
  return perProject?.hidden ?? false;
}
