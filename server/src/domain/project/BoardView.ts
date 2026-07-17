// Пользовательская вью доски проекта (Notion-style, db/103): именованное представление
// задач. Дефолтная вкладка «Доска» (канбан) — неявная, в БД не хранится.
// Mirrors client/src/domain/project/BoardView.ts.

export const BOARD_VIEW_TYPES = [
  'kanban',
  'table',
  'list',
  'calendar',
] as const;

export type BoardViewType = (typeof BOARD_VIEW_TYPES)[number];

export type BoardView = {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly type: BoardViewType;
  readonly sortOrder: number;
  // Пер-вью настройки (db/105) — прозрачный JSON, структуру знает клиент.
  readonly config: Record<string, unknown> | null;
  readonly createdAt: Date;
};
