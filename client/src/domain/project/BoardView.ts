// Пользовательская вью доски проекта (Notion-style, db/103): именованное представление
// задач. Дефолтная вкладка «Доска» (канбан) — неявная, в БД не хранится.
// Mirrors server/src/domain/project/BoardView.ts.

export const BOARD_VIEW_TYPES = [
  'kanban',
  'table',
  'list',
  'calendar',
] as const;

export type BoardViewType = (typeof BOARD_VIEW_TYPES)[number];

export const BOARD_VIEW_LAYOUT_TYPES: readonly BoardViewType[] = [
  'table',
  'kanban',
  'calendar',
  'list',
];

export const BOARD_VIEW_TYPE_LABELS: Record<BoardViewType, string> = {
  kanban: 'Доска',
  table: 'Таблица',
  list: 'Список',
  calendar: 'Календарь',
};

export type BoardView = {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly type: BoardViewType;
  readonly sortOrder: number;
  // Пер-вью настройки (db/105): фильтры/сортировка/колонки/группировка/цвета.
  // Domain хранит как прозрачный JSON — типизацию знает presentation-слой.
  readonly config: Record<string, unknown> | null;
  readonly createdAt: Date;
};
