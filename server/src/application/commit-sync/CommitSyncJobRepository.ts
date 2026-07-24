import type {
  CommitSyncAction,
  CommitSyncJob,
  CommitSyncStatus,
} from '../../domain/commit-sync/CommitSyncJob.js';

export type NewCommitSyncJobInput = {
  readonly projectId: string;
  // Инициатор (владелец проекта) — на его тариф метерим/гейтим (db/089).
  readonly createdBy: string | null;
  readonly dispatcherUserId: string;
  // Снимок действия из настроек (propose|auto).
  readonly action: CommitSyncAction;
  // Ключ батча '<groupChatId>:<YYYY-MM-DD>:<HH>:<MM>' (db/143). null — одиночная доставка.
  readonly batchKey: string | null;
  readonly thresholdHours: number;
  readonly context: string | null;
  readonly commitsJson: string | null;
};

export type PendingCommitSyncJob = {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string | null;
  readonly createdAt: Date;
};

// Строка для «прогресс-сообщения» батча (db/145): проект + его текущий статус. Порядок стабильный
// (по createdAt), чтобы список проектов не «прыгал» между правками сообщения.
export type CommitSyncBatchStatus = {
  readonly projectId: string;
  readonly projectName: string | null;
  readonly status: CommitSyncStatus;
};

export type CommitSyncJobRepository = {
  create(input: NewCommitSyncJobInput): Promise<CommitSyncJob>;
  findById(id: string): Promise<CommitSyncJob | null>;
  /** queued job'ы где dispatcher_user_id = userId, createdAt asc, limit 1..50. */
  listPendingForDispatcher(userId: string, limit: number): Promise<PendingCommitSyncJob[]>;
  /** Есть ли queued/running job у проекта — дедуп enqueue (не плодим параллельные прогоны). */
  existsActiveForProject(projectId: string): Promise<boolean>;
  /** Атомарный claim: UPDATE WHERE id=? AND status='queued' → running. null если не удался. */
  claimById(jobId: string): Promise<CommitSyncJob | null>;
  complete(input: {
    readonly id: string;
    readonly status: Extract<CommitSyncStatus, 'succeeded' | 'failed' | 'cancelled'>;
    readonly matchesJson: string | null;
    // Per-job payload сводки (db/143). null — чистый проект / доставка не для группы.
    readonly reviewJson: string | null;
    readonly resultSummary: string | null;
    readonly error: string | null;
    readonly costUsd: number | null;
    readonly tokensIn: number | null;
    readonly tokensOut: number | null;
  }): Promise<void>;
  cancelStale(input: {
    readonly olderThan: Date;
    readonly statuses: ReadonlyArray<Extract<CommitSyncStatus, 'queued' | 'running'>>;
  }): Promise<number>;
  deleteTerminal(input: { readonly olderThan: Date }): Promise<number>;

  // --- Батчинг сводок (db/143) ---
  /** Все job'ы батча (для агрегации сборщиком). */
  listByBatchKey(batchKey: string): Promise<CommitSyncJob[]>;
  /**
   * Проекты батча + их текущий статус для «прогресс-сообщения» (db/145). Порядок стабильный
   * (по createdAt) — список проектов не «прыгает» между правками сообщения.
   */
  listBatchStatuses(batchKey: string): Promise<CommitSyncBatchStatus[]>;
  /**
   * Атомарно пометить весь батч отправленным (SET batch_flushed_at на все строки), НО только если
   * не осталось незавершённых job'ов и флаг ещё не стоял. true — этот вызов выбран сборщиком.
   */
  tryMarkBatchFlushed(batchKey: string): Promise<boolean>;
  /** То же для одиночного job'а без batch_key (ручная «Сверить сейчас»). */
  tryMarkJobFlushed(jobId: string): Promise<boolean>;
  /** batch_key'и, где все job'ы терминальны, но сообщение ещё не слали (safety sweep). */
  findFlushableBatchKeys(): Promise<string[]>;
};
