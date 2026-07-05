import type { PublicBoard } from '@/domain/public/PublicBoard';

// Порт публичной доски (Publish to web). Anon-доступ по slug. getBoard возвращает null,
// если доска не найдена/не опубликована (сервер отдаёт 404 — не различаем, так задумано).
export interface PublicBoardRepository {
  getBoard(slug: string): Promise<PublicBoard | null>;
}
