// LIVE-сессия одного прогона воркера по задаче. Метаданные + статус + база seq +
// итоговая стоимость/токены. События ленты хранятся отдельно (LiveEvent), привязаны
// к сессии через session_id; нумеруются `seq` начиная с `baseSeq`.
export type LiveSessionStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'canceled';

export type LiveSession = {
  readonly id: string;
  readonly taskId: string;
  readonly projectId: string;
  // Имя агента (ralph-worker и т.п.) — маппится в читаемый title в UI.
  readonly agentName: string;
  // Номер попытки задачи (1-based). Используется в селекторе сессий.
  readonly attempt: number;
  readonly status: LiveSessionStatus;
  readonly model: string | null;
  // HEAD-коммит до/после сессии — для git-диффа.
  readonly headBefore: string | null;
  readonly headAfter: string | null;
  // Стоимость API-эквивалента и токены (с финал-события воркера).
  readonly costUsd: number | null;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  // Сколько событий записано и максимальный seq — для replay/пагинации.
  readonly eventCount: number;
  readonly lastSeq: number;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
};

// Сессия в работе — бейдж 🔴 и открытый SSE-стрим.
export function isLiveSessionRunning(session: LiveSession | null): boolean {
  return session?.status === 'running';
}
