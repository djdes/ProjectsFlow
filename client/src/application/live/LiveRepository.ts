import type { LiveSession } from '@/domain/live/LiveSession';
import type { LiveEvent } from '@/domain/live/LiveEvent';
import type { LiveFileDiff } from '@/domain/live/LiveFileDiff';

// Порт чтения LIVE-данных задачи (только REST). Live-стрим (SSE) подключается
// напрямую в хуке useLiveSession через EventSource — он не часть этого порта,
// потому что EventSource не вписывается в request/response-модель httpClient'а
// (паттерн зеркалит useNotificationStream).
export interface LiveRepository {
  // Сессии задачи, newest-first.
  listSessions(projectId: string, taskId: string): Promise<LiveSession[]>;
  // События сессии с seq > afterSeq (для replay/пагинации). limit ограничивает батч.
  listEvents(
    projectId: string,
    taskId: string,
    sessionId: string,
    afterSeq?: number,
    limit?: number,
  ): Promise<LiveEvent[]>;
  // Полные git-диффы файлов сессии (из событий file_diff), для финального просмотра.
  listFileDiffs(projectId: string, taskId: string, sessionId: string): Promise<LiveFileDiff[]>;
}
