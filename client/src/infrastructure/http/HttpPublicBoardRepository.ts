import { httpClient } from './httpClient';
import { HttpError } from '@/lib/HttpError';
import type { PublicBoardRepository } from '@/application/public/PublicBoardRepository';
import type {
  PublicBoard,
  PublicTaskAccess,
  PublicTaskDetail,
} from '@/domain/public/PublicBoard';

// null при 404 — общий хелпер для всех публичных GET'ов.
async function getOrNull<T>(path: string): Promise<T | null> {
  try {
    return await httpClient.get<T>(path);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  }
}

// Анонимный fetch публичной доски по slug. Сервер уже отдаёт готовый whitelisted DTO,
// поэтому маппинг тривиальный (все поля примитивы/строки). 404 → null.
export class HttpPublicBoardRepository implements PublicBoardRepository {
  async getBoard(slug: string): Promise<PublicBoard | null> {
    const res = await getOrNull<{ board: PublicBoard }>(
      `/public/boards/${encodeURIComponent(slug)}`,
    );
    return res ? res.board : null;
  }

  async getTaskDetail(slug: string, taskId: string): Promise<PublicTaskDetail | null> {
    const res = await getOrNull<{ task: PublicTaskDetail }>(
      `/public/boards/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(taskId)}`,
    );
    return res ? res.task : null;
  }

  async getTaskAccess(slug: string, taskId: string): Promise<PublicTaskAccess | null> {
    return getOrNull<PublicTaskAccess>(
      `/public/boards/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(taskId)}/access`,
    );
  }

  async clone(slug: string): Promise<{ projectId: string }> {
    return httpClient.post<{ projectId: string }>(
      `/public/boards/${encodeURIComponent(slug)}/clone`,
      {},
    );
  }
}
