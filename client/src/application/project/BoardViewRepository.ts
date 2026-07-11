import type { BoardView, BoardViewType } from '@/domain/project/BoardView';

// Пользовательские вью доски проекта (Notion-style, db/103). Read — участник,
// мутации — editor+ (сервер гейтит; viewer получает 403 → тост).
export interface BoardViewRepository {
  list(projectId: string): Promise<BoardView[]>;
  create(projectId: string, name: string, type: BoardViewType): Promise<BoardView>;
  rename(projectId: string, viewId: string, name: string): Promise<BoardView>;
  duplicate(projectId: string, viewId: string): Promise<BoardView>;
  remove(projectId: string, viewId: string): Promise<void>;
}
