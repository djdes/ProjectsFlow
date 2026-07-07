import type {
  PublicBoard,
  PublicTaskAccess,
  PublicTaskDetail,
} from '@/domain/public/PublicBoard';

// Порт публичной доски (Publish to web). Anon-доступ по slug. Методы возвращают null,
// если доска/задача не найдена/не опубликована (сервер отдаёт 404 — не различаем, так задумано).
export interface PublicBoardRepository {
  getBoard(slug: string): Promise<PublicBoard | null>;
  // Read-only деталь задачи (тело + фото + комментарии) для окна на доске.
  getTaskDetail(slug: string, taskId: string): Promise<PublicTaskDetail | null>;
  // Гейт отдельной страницы задачи: projectId + факт членства текущей сессии.
  getTaskAccess(slug: string, taskId: string): Promise<PublicTaskAccess | null>;
  // Дублировать доску в свой аккаунт (ТРЕБУЕТ сессии). Возвращает id нового проекта.
  clone(slug: string): Promise<{ projectId: string }>;
}
