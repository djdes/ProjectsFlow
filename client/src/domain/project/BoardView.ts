// Пользовательская вью доски проекта (Notion-style, db/103): именованное представление
// задач. Дефолтная вкладка «Доска» (канбан) — неявная, в БД не хранится.
// Mirrors server/src/domain/project/BoardView.ts.

export type BoardViewType =
  | 'kanban'
  | 'table'
  | 'list'
  | 'calendar'
  | 'timeline'
  | 'gallery'
  | 'chart'
  | 'feed'
  | 'map'
  | 'dashboard'
  | 'form';

export const BOARD_VIEW_TYPES: readonly BoardViewType[] = [
  'kanban',
  'table',
  'list',
  'calendar',
  'timeline',
  'gallery',
  'chart',
  'feed',
  'map',
  'dashboard',
  'form',
];

export const BOARD_VIEW_LAYOUT_TYPES: readonly BoardViewType[] = [
  'table',
  'kanban',
  'timeline',
  'calendar',
  'list',
  'gallery',
  'chart',
  'feed',
  'map',
];

export const BOARD_VIEW_TYPE_LABELS: Record<BoardViewType, string> = {
  kanban: 'Доска',
  table: 'Таблица',
  list: 'Список',
  calendar: 'Календарь',
  timeline: 'Таймлайн',
  gallery: 'Галерея',
  chart: 'График',
  feed: 'Лента',
  map: 'Карта',
  dashboard: 'Дашборд',
  form: 'Форма',
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
