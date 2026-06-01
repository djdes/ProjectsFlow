// Метаданные одного прогона Ralph-воркера по задаче (LIVE-вкладка). События живут в
// task_progress_events (kind-based), сессия хранит статус/база seq/стоимость/HEAD'ы.

export type LiveSessionStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'canceled';

// Терминальные статусы — те, в которые переходит finishSession.
export type LiveSessionFinalStatus = Exclude<LiveSessionStatus, 'running'>;

export type LiveSession = {
  readonly id: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly agentName: string | null;
  readonly attempt: number;
  readonly status: LiveSessionStatus;
  readonly model: string | null;
  readonly headBefore: string | null;
  readonly headAfter: string | null;
  readonly costUsd: number | null;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly baseSeq: number;
  readonly lastSeq: number;
  readonly eventCount: number;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
};
