import type {
  MonitoringServer,
  OverviewProject,
  ServerConfigInput,
  ServerWithLatest,
} from '@/domain/monitoring/Server';
import type { LogKind, LogTail, ServerSnapshot, TrendPoint } from '@/domain/monitoring/Snapshot';
import type { AlertRule, ServerAlert } from '@/domain/monitoring/Alert';
import type { MonitoringAnalysisResult, MonitoringAnalysisType } from '@/domain/monitoring/Analysis';

export type HistoryOptions = {
  readonly since?: Date;
  readonly until?: Date;
  readonly limit?: number;
};

export interface MonitoringRepository {
  listServers(projectId: string): Promise<ServerWithLatest[]>;
  getLatest(projectId: string, serverId: string): Promise<ServerSnapshot | null>;
  getHistory(projectId: string, serverId: string, opts?: HistoryOptions): Promise<TrendPoint[]>;
  getLogs(projectId: string, serverId: string, kind: LogKind): Promise<LogTail | null>;
  listAlerts(projectId: string, activeOnly: boolean): Promise<ServerAlert[]>;
  triggerCollect(projectId: string, serverId: string): Promise<ServerSnapshot>;
  createServer(projectId: string, input: ServerConfigInput): Promise<MonitoringServer>;
  updateServer(projectId: string, serverId: string, input: ServerConfigInput): Promise<MonitoringServer>;
  deleteServer(projectId: string, serverId: string): Promise<void>;
  muteServer(projectId: string, serverId: string, minutes: number | null): Promise<MonitoringServer>;
  getAlertRules(projectId: string): Promise<AlertRule[]>;
  saveAlertRules(projectId: string, rules: AlertRule[]): Promise<AlertRule[]>;
  getOverview(): Promise<OverviewProject[]>;
  // AI-анализ мониторинга (db/063): enqueue → long-poll результата → история.
  enqueueAnalysis(
    projectId: string,
    serverId: string,
    analysisType: MonitoringAnalysisType,
  ): Promise<{ jobId: string }>;
  waitAnalysis(jobId: string, waitSeconds?: number): Promise<MonitoringAnalysisResult>;
  listAnalysisHistory(projectId: string, serverId: string): Promise<MonitoringAnalysisResult[]>;
}
