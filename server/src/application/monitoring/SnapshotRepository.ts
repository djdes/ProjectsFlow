import type {
  ServerSnapshot,
  SnapshotMetrics,
  SnapshotSource,
  LogTails,
  DbHealth,
  ServerHealthStatus,
} from '../../domain/monitoring/ServerSnapshot.js';

export type NewSnapshotInput = {
  readonly id: string;
  readonly serverId: string;
  readonly projectId: string;
  readonly collectedAt: Date;
  readonly source: SnapshotSource;
  readonly status: ServerHealthStatus;
  readonly reachable: boolean;
  readonly metrics: SnapshotMetrics | null;
  readonly logs: LogTails | null;
  readonly dbHealth: DbHealth | null;
  readonly errors: string[] | null;
  readonly pushedByUserId: string | null;
  readonly agentTokenId: string | null;
};

// Облегчённая точка тренда — только числовые колонки (без тяжёлых JSON payload'ов).
export type TrendPoint = {
  readonly collectedAt: Date;
  readonly status: string;
  readonly cpuLoad1: number | null;
  readonly memUsedPct: number | null;
  readonly diskUsedPct: number | null;
  readonly pm2Online: number | null;
  readonly pm2RestartTotal: number | null;
};

export type HistoryQuery = {
  readonly since?: Date;
  readonly until?: Date;
  readonly limit: number;
};

export interface SnapshotRepository {
  insert(input: NewSnapshotInput): Promise<ServerSnapshot>;
  getLatest(serverId: string): Promise<ServerSnapshot | null>;
  // Снимок, предшествующий моменту (для restart_spike: diff с прошлым).
  getLatestBefore(serverId: string, before: Date): Promise<ServerSnapshot | null>;
  listLatestPerServer(projectId: string): Promise<Map<string, ServerSnapshot>>;
  getHistory(serverId: string, query: HistoryQuery): Promise<TrendPoint[]>;
  pruneOlderThan(cutoff: Date, limit: number): Promise<number>;
}
