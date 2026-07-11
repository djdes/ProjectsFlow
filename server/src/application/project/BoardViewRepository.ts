import type { BoardView, BoardViewType } from '../../domain/project/BoardView.js';

export type CreateBoardViewInput = {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly type: BoardViewType;
  readonly createdBy: string;
};

// Пользовательские вью доски (db/103). Гейты доступа — в роутах (паттерн kanban-settings):
// чтение — участник проекта, изменение — editor+.
export interface BoardViewRepository {
  listForProject(projectId: string): Promise<BoardView[]>;
  getById(id: string): Promise<BoardView | null>;
  // sort_order назначается репозиторием: MAX(project) + 1 — новая вью встаёт в конец ряда.
  create(input: CreateBoardViewInput): Promise<BoardView>;
  rename(id: string, name: string): Promise<BoardView | null>;
  delete(id: string): Promise<void>;
}
