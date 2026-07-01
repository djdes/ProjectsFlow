import type { CommitSyncJob, CommitSyncStatus } from '../../domain/commit-sync/CommitSyncJob.js';

export type NewCommitSyncJobInput = {
  readonly projectId: string;
  // Инициатор (владелец проекта) — на его тариф метерим/гейтим (db/089).
  readonly createdBy: string | null;
  readonly dispatcherUserId: string;
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
};
