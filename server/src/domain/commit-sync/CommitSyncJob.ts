// Доменные типы для ежедневной авто-обработки статусов задач по коммитам.
// Зеркало monitoring-analysis/MonitoringAnalysisJob.ts. Воркер (ralph) — чистый матчер:
// возвращает совпадения коммит↔задача; порог и перемещения применяет сервер при complete.

export type CommitSyncStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export const COMMIT_SYNC_STATUSES: readonly CommitSyncStatus[] = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
];

// Что делать с совпадениями коммит↔задача при complete (db/101):
//   'propose' — создать предложение закрыть (human-in-the-loop, дефолт);
//   'auto'    — прежнее поведение (двигать по порогу возраста коммита).
export type CommitSyncAction = 'propose' | 'auto';

// Одно совпадение от воркера: коммит commitSha по смыслу относится к задаче taskId.
// reason — короткое обоснование (для лога/сводки). Без решения о статусе — это серверное.
export type CommitSyncMatch = {
  readonly taskId: string;
  readonly commitSha: string;
  readonly reason: string | null;
};

// A deliberately selected commit from the daily review window. The worker may
// return one, several, or none: this is a review of meaningful changes, not a
// mechanical dump of every commit.
export type CommitSyncReview = {
  readonly commitSha: string;
  readonly verdict: 'good' | 'attention';
  readonly summary: string;
};

export type CommitSyncJob = {
  readonly id: string;
  readonly projectId: string;
  // Инициатор (владелец проекта, включивший автоматизацию) — на его тариф метерим/гейтим.
  // null для старых job'ов (db/089) → fallback на dispatcherUserId.
  readonly createdBy: string | null;
  readonly dispatcherUserId: string;
  readonly status: CommitSyncStatus;
  // Снимок действия из настроек на момент enqueue (propose|auto).
  readonly action: CommitSyncAction;
  // Снапшот порога (часы) на момент enqueue — авторитетен при применении.
  readonly thresholdHours: number;
  readonly context: string | null;
  // Снимок sha → committedAt (ISO) на момент enqueue (JSON-строка).
  readonly commitsJson: string | null;
  // Совпадения от воркера (JSON-строка массива CommitSyncMatch).
  readonly matchesJson: string | null;
  readonly resultSummary: string | null;
  readonly error: string | null;
  readonly costUsd: number | null;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly claimedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};
