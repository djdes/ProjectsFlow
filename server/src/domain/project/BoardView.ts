// Пользовательская вью доски проекта (Notion-style, db/103): именованное представление
// задач. Дефолтная вкладка «Доска» (канбан) — неявная, в БД не хранится.
// Mirrors client/src/domain/project/BoardView.ts.

export type BoardViewType = 'kanban' | 'table' | 'list' | 'calendar';

export const BOARD_VIEW_TYPES: readonly BoardViewType[] = [
  'kanban',
  'table',
  'list',
  'calendar',
];

export type BoardView = {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly type: BoardViewType;
  readonly sortOrder: number;
  readonly createdAt: Date;
};
