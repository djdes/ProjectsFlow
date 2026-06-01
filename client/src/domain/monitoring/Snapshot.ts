export type ServerHealthStatus = 'ok' | 'degraded' | 'down' | 'stale' | 'unknown';

export type Pm2ProcessSnapshot = {
  readonly name: string;
  readonly pid: number | null;
  readonly status: string;
  readonly uptimeMs: number | null;
  readonly restarts: number | null;
  readonly cpuPct: number | null;
  readonly memoryBytes: number | null;
};

export type DiskUsage = {
  readonly mount: string;
  readonly totalBytes: number;
  readonly usedBytes: number;
  readonly availableBytes: number;
  readonly usedPct: number;
};

export type SystemSnapshot = {
  readonly load1: number | null;
  readonly load5: number | null;
  readonly load15: number | null;
  readonly cpuCount: number | null;
  readonly memTotalBytes: number | null;
  readonly memUsedBytes: number | null;
  readonly memUsedPct: number | null;
  readonly uptimeSeconds: number | null;
  readonly disks: ReadonlyArray<DiskUsage>;
};

export type LogTail = {
  readonly available: boolean;
  readonly reason?: string;
  readonly lines?: string;
  readonly bytes?: number;
};

export type SnapshotMetrics = {
  readonly pm2: ReadonlyArray<Pm2ProcessSnapshot>;
  readonly system: SystemSnapshot | null;
};

export type ServerSnapshot = {
  readonly id: string;
  readonly serverId: string;
  readonly projectId: string;
  readonly collectedAt: Date;
  readonly source: 'local' | 'agent';
  readonly status: ServerHealthStatus;
  readonly reachable: boolean;
  readonly metrics: SnapshotMetrics | null;
  readonly errors: ReadonlyArray<string> | null;
};

export type TrendPoint = {
  readonly collectedAt: Date;
  readonly status: string;
  readonly cpuLoad1: number | null;
  readonly memUsedPct: number | null;
  readonly diskUsedPct: number | null;
  readonly pm2Online: number | null;
  readonly pm2RestartTotal: number | null;
};

export type LogKind = 'pm2_out' | 'pm2_err' | 'nginx_access' | 'nginx_error';
