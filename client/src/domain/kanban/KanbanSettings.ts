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

// Кастомные колонки проекта (db/154) живут на резервных слотах статуса — см. подробное
// обоснование в server/src/domain/kanban/KanbanSettings.ts. Слот занят, когда задан label.
export const CUSTOM_KANBAN_SLOTS = [
  'custom_1',
  'custom_2',
  'custom_3',
  'custom_4',
  'custom_5',
] as const;
export type CustomKanbanSlot = (typeof CUSTOM_KANBAN_SLOTS)[number];

// Всё, что вообще может быть колонкой доски: встроенные + слоты под кастомные.
export const KANBAN_COLUMN_STATUSES = [
  ...VISIBLE_KANBAN_STATUSES,
  ...CUSTOM_KANBAN_SLOTS,
] as const;
export type KanbanColumnStatus = (typeof KANBAN_COLUMN_STATUSES)[number];

export function isCustomKanbanSlot(s: string): s is CustomKanbanSlot {
  return (CUSTOM_KANBAN_SLOTS as readonly string[]).includes(s);
}

export function isKanbanColumnStatus(s: string): s is KanbanColumnStatus {
  return (KANBAN_COLUMN_STATUSES as readonly string[]).includes(s);
}

export type KanbanColumnSettings = {
  readonly color?: KanbanColor;
  readonly label?: string;
  readonly hidden?: boolean;
  // Только для кастомных слотов: индекс вставки во встроенном списке. Нет — в конец доски.
  readonly position?: number;
};

export type KanbanBoardSettings = Partial<Record<KanbanColumnStatus, KanbanColumnSettings>>;
export type KanbanDefaultColors = Partial<Record<VisibleKanbanStatus, KanbanColor>>;

// Активна ли кастомная колонка: у слота задан непустой label.
export function isCustomColumnActive(perProject: KanbanColumnSettings | undefined): boolean {
  return (perProject?.label?.trim().length ?? 0) > 0;
}

export function activeCustomSlots(
  settings: KanbanBoardSettings | null | undefined,
): CustomKanbanSlot[] {
  return CUSTOM_KANBAN_SLOTS.filter((slot) => isCustomColumnActive(settings?.[slot]));
}

// Колонки доски в порядке отображения: встроенные + активные кастомные (по position,
// без него — в конец). Зеркало серверной kanbanColumnOrder.
export function kanbanColumnOrder(
  settings: KanbanBoardSettings | null | undefined,
): KanbanColumnStatus[] {
  const out: KanbanColumnStatus[] = [...VISIBLE_KANBAN_STATUSES];
  const custom = activeCustomSlots(settings)
    .map((slot) => ({ slot, position: settings?.[slot]?.position }))
    .sort(
      (a, b) =>
        (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER),
    );
  for (const { slot, position } of custom) {
    const at = position === undefined ? out.length : Math.max(0, Math.min(position, out.length));
    out.splice(at, 0, slot);
  }
  return out;
}

// Подпись кастомной колонки: label слота, фолбэк «Колонка N» (для задач, оставшихся в
// освобождённом слоте).
export function customColumnLabel(
  perProject: KanbanColumnSettings | undefined,
  slot: CustomKanbanSlot,
): string {
  const custom = perProject?.label?.trim();
  return custom && custom.length > 0 ? custom : `Колонка ${slot.slice('custom_'.length)}`;
}

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
  status: KanbanColumnStatus,
): KanbanColor {
  if (perProject?.color && perProject.color !== 'default') return perProject.color;
  if (userDefault && userDefault !== 'default') return userDefault;
  // У кастомных колонок встроенного цвета нет — нейтральный серый.
  return isCustomKanbanSlot(status) ? 'gray' : BUILTIN_KANBAN_COLORS[status];
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
