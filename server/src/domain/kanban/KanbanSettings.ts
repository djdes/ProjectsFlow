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

// Кастомные колонки проекта (db/154) живут на резервных слотах статуса. Полноценный
// переезд tasks.status с ENUM на таблицу колонок стоил бы миграции данных и правок в
// ~14 местах; пять заранее заведённых слотов дают ту же продуктовую возможность почти
// без рефакторинга. Слот «занят» ровно тогда, когда в kanban_settings у него задан label.
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
  // Только для кастомных слотов: куда вставить колонку среди встроенных (0-based индекс
  // во ВСТРОЕННОМ списке). Не задан — колонка идёт в конец доски.
  readonly position?: number;
};

// projects.kanban_settings — sparse map (NULL / {} = built-in defaults).
export type KanbanBoardSettings = Partial<Record<KanbanColumnStatus, KanbanColumnSettings>>;

// Активна ли кастомная колонка: у слота задан непустой label.
export function isCustomColumnActive(perProject: KanbanColumnSettings | undefined): boolean {
  return (perProject?.label?.trim().length ?? 0) > 0;
}

// Занятые кастомные слоты проекта, в порядке слотов.
export function activeCustomSlots(settings: KanbanBoardSettings | null | undefined): CustomKanbanSlot[] {
  return CUSTOM_KANBAN_SLOTS.filter((slot) => isCustomColumnActive(settings?.[slot]));
}

// Первый свободный слот под новую колонку. null = все 5 заняты.
export function firstFreeCustomSlot(
  settings: KanbanBoardSettings | null | undefined,
): CustomKanbanSlot | null {
  return CUSTOM_KANBAN_SLOTS.find((slot) => !isCustomColumnActive(settings?.[slot])) ?? null;
}

/**
 * Колонки доски проекта в порядке отображения: встроенные + активные кастомные.
 *
 * Кастомная колонка встаёт на свой `position` (индекс во встроенном списке); без него —
 * в конец. Слоты обрабатываются по возрастанию position, чтобы результат не зависел от
 * порядка вставки в kanban_settings.
 */
export function kanbanColumnOrder(
  settings: KanbanBoardSettings | null | undefined,
): KanbanColumnStatus[] {
  const out: KanbanColumnStatus[] = [...VISIBLE_KANBAN_STATUSES];
  const custom = activeCustomSlots(settings)
    .map((slot) => ({ slot, position: settings?.[slot]?.position }))
    .sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER));
  for (const { slot, position } of custom) {
    const at = position === undefined ? out.length : Math.max(0, Math.min(position, out.length));
    out.splice(at, 0, slot);
  }
  return out;
}

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
  status: KanbanColumnStatus,
): KanbanColor {
  if (perProject?.color && perProject.color !== 'default') return perProject.color;
  if (userDefault && userDefault !== 'default') return userDefault;
  // У кастомных колонок встроенного цвета нет — нейтральный серый.
  return isCustomKanbanSlot(status) ? 'gray' : BUILTIN_KANBAN_COLORS[status];
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
  status: KanbanColumnStatus,
): string {
  const custom = perProject?.label?.trim();
  if (custom && custom.length > 0) return custom;
  // Кастомный слот без label колонкой не считается; подпись-заглушка нужна только там,
  // где статус пришёл из старых данных (задача в слоте освобождённой колонки).
  return isCustomKanbanSlot(status)
    ? `Колонка ${status.slice('custom_'.length)}`
    : BUILTIN_KANBAN_LABELS[status];
}

// Скрыта ли колонка на доске проекта (per-project hidden=true).
export function isColumnHidden(perProject: KanbanColumnSettings | undefined): boolean {
  return perProject?.hidden === true;
}
