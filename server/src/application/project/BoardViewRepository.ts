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
  update(
    id: string,
    patch: { name?: string; type?: BoardViewType; config?: Record<string, unknown> | null },
  ): Promise<BoardView | null>;
  delete(id: string): Promise<void>;
}
