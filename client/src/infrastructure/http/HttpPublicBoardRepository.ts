import { httpClient } from './httpClient';
import { HttpError } from '@/lib/HttpError';
import type { PublicBoardRepository } from '@/application/public/PublicBoardRepository';
import type { PublicBoard } from '@/domain/public/PublicBoard';

// Анонимный fetch публичной доски по slug. Сервер уже отдаёт готовый whitelisted DTO,
// поэтому маппинг тривиальный (все поля примитивы/строки). 404 → null.
export class HttpPublicBoardRepository implements PublicBoardRepository {
  async getBoard(slug: string): Promise<PublicBoard | null> {
    try {
      const { board } = await httpClient.get<{ board: PublicBoard }>(
        `/public/boards/${encodeURIComponent(slug)}`,
      );
      return board;
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return null;
      throw e;
    }
  }
}
