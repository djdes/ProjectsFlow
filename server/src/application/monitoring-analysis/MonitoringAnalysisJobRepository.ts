import type {
  MonitoringAnalysisJob,
  MonitoringAnalysisStatus,
  MonitoringAnalysisType,
} from '../../domain/monitoring-analysis/MonitoringAnalysisJob.js';

export type NewMonitoringAnalysisJobInput = {
  readonly createdBy: string;
  readonly projectId: string;
  readonly serverId: string;
  readonly dispatcherUserId: string;
  readonly analysisType: MonitoringAnalysisType;
  readonly alertId: string | null;
  readonly context: string | null;
  readonly note: string | null;
};

export type PendingMonitoringAnalysisJob = {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string | null;
  readonly serverId: string;
  readonly serverName: string | null;
  readonly analysisType: MonitoringAnalysisType;
  readonly createdAt: Date;
};

export type MonitoringAnalysisJobRepository = {
  create(input: NewMonitoringAnalysisJobInput): Promise<MonitoringAnalysisJob>;
  findById(id: string): Promise<MonitoringAnalysisJob | null>;
  /** queued job'ы где dispatcher_user_id = userId, createdAt asc, limit 1..50. */
  listPendingForDispatcher(userId: string, limit: number): Promise<PendingMonitoringAnalysisJob[]>;
  /** История анализов сервера (succeeded в первую очередь полезны), createdAt desc. */
  listByServer(serverId: string, limit: number): Promise<MonitoringAnalysisJob[]>;
  /** Атомарный claim: UPDATE WHERE id=? AND status='queued' → running. null если не удался. */
  claimById(jobId: string): Promise<MonitoringAnalysisJob | null>;
  complete(input: {
    readonly id: string;
    readonly status: Extract<MonitoringAnalysisStatus, 'succeeded' | 'failed' | 'cancelled'>;
    readonly resultMarkdown: string | null;
    readonly error: string | null;
    readonly costUsd: number | null;
    readonly tokensIn: number | null;
    readonly tokensOut: number | null;
  }): Promise<void>;
  cancelStale(input: {
    readonly olderThan: Date;
    readonly reason: string;
    readonly statuses: ReadonlyArray<Extract<MonitoringAnalysisStatus, 'queued' | 'running'>>;
  }): Promise<number>;
  deleteTerminal(input: { readonly olderThan: Date }): Promise<number>;
};
