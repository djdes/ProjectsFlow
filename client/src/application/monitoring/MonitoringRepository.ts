import type { MonitoringServer, ServerConfigInput, ServerWithLatest } from '@/domain/monitoring/Server';
import type { LogKind, LogTail, ServerSnapshot, TrendPoint } from '@/domain/monitoring/Snapshot';
import type { AlertRule, ServerAlert } from '@/domain/monitoring/Alert';

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
}
