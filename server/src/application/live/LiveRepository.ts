import type { LiveSession, LiveSessionFinalStatus } from '../../domain/live/LiveSession.js';
import type { LiveEvent, LiveEventInput } from '../../domain/live/LiveEvent.js';
import type { LiveFileDiff } from '../../domain/live/LiveFileDiff.js';

export type InsertLiveSessionInput = {
  readonly id: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly agentName: string | null;
  readonly attempt: number;
  readonly model: string | null;
  // Плательщик прогона (создатель задачи) — на него метеринг/гейт. null — fallback.
  readonly billedUserId: string | null;
  readonly headBefore: string | null;
  readonly baseSeq: number;
  // expires_at = NOW() + ttlSeconds (по часам БД). null → без срока.
  readonly ttlSeconds: number | null;
};

export type FinishLiveSessionInput = {
  readonly status: LiveSessionFinalStatus;
  readonly headAfter: string | null;
  readonly costUsd: number | null;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
};

// Порт хранилища LIVE-сессий + событий (события пишутся в ту же task_progress_events).
export interface LiveRepository {
  // Стартовый seq для новой сессии = MAX(seq for task) + 1 (атомарно от текущей ленты задачи).
  maxSeqForTask(taskId: string): Promise<number>;

  insertSession(input: InsertLiveSessionInput): Promise<void>;
  getSession(sessionId: string): Promise<LiveSession | null>;
  listSessions(taskId: string): Promise<LiveSession[]>;

  // Проектный обзор воркера (раздел Agents): последние прогоны по ВСЕМ задачам проекта,
  // новые сверху. limit — потолок числа строк (карточка показывает историю).
  listRecentProjectSessions(projectId: string, limit: number): Promise<LiveSession[]>;
  // Сколько сейчас идёт (status='running') прогонов в проекте — «воркер занят».
  countRunningProjectSessions(projectId: string): Promise<number>;

  // Идемпотентный append одного события в task_progress_events (с session_id).
  // false — дубль по UNIQUE(task_id, seq) (ER_DUP_ENTRY), true — записано.
  appendEvent(input: {
    sessionId: string;
    taskId: string;
    projectId: string;
    event: LiveEventInput;
  }): Promise<boolean>;

  // Обновить курсор сессии после успешного append'а батча.
  bumpSession(sessionId: string, lastSeq: number, eventCount: number): Promise<void>;

  finishSession(sessionId: string, input: FinishLiveSessionInput): Promise<void>;

  listEvents(sessionId: string, afterSeq: number, limit: number): Promise<LiveEvent[]>;
  listFileDiffs(sessionId: string): Promise<LiveFileDiff[]>;

  // Startup-sweep: зависшие running-сессии (процесс упал) → timeout.
  sweepStaleRunning(olderThanHours: number): Promise<number>;
}
