// Value-types снимка метрик сервера. Импортируются Drizzle-схемой через `import type`
// для $type<>() на JSON-колонках, поэтому 0 зависимостей на инфраструктуру/HTTP.

export type ServerHealthStatus = 'ok' | 'degraded' | 'down' | 'stale' | 'unknown';

// Один pm2-процесс из `pm2 jlist`.
export type Pm2ProcessSnapshot = {
  readonly name: string;
  readonly pid: number | null;
  readonly status: string; // online | stopped | errored | launching | ...
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
  // Мгновенная загрузка CPU всей машины, % (по двум семплам /proc/stat). Optional —
  // старые снимки/remote без поля.
  readonly cpuUsedPct?: number | null;
  readonly memTotalBytes: number | null;
  readonly memUsedBytes: number | null;
  readonly memUsedPct: number | null;
  // Swap (из /proc/meminfo). Optional.
  readonly swapTotalBytes?: number | null;
  readonly swapUsedBytes?: number | null;
  readonly swapUsedPct?: number | null;
  // Сетевой I/O (кумулятивные счётчики /proc/net/dev, сумма по не-lo). Optional.
  readonly netRxBytes?: number | null;
  readonly netTxBytes?: number | null;
  // Число процессов и открытых файловых дескрипторов в системе. Optional.
  readonly processCount?: number | null;
  readonly openFds?: number | null;
  readonly uptimeSeconds: number | null;
  readonly disks: ReadonlyArray<DiskUsage>;
};

export type DbHealth = {
  readonly reachable: boolean;
  readonly connections: number | null;
  readonly sizeBytes: number | null;
  // Расширенные метрики MariaDB. Optional — заполняются для local-сервера.
  readonly maxConnections?: number | null;
  readonly uptimeSeconds?: number | null;
  readonly slowQueries?: number | null;
  readonly version?: string | null;
};

// Хвост лога. available=false → причина в reason; иначе lines (редактирован+усечён).
export type LogTail = {
  readonly available: boolean;
  readonly reason?: 'no_path' | 'not_found' | 'forbidden' | 'empty' | 'error';
  readonly lines?: string;
  readonly bytes?: number;
};

export type LogTails = {
  readonly pm2Out: LogTail | null;
  readonly pm2Err: LogTail | null;
  readonly nginxAccess: LogTail | null;
  readonly nginxError: LogTail | null;
};

// Синтетическая HTTP-проверка (uptime). ok=false → http_down.
export type HttpCheck = {
  readonly url: string;
  readonly ok: boolean;
  readonly statusCode: number | null;
  readonly latencyMs: number | null;
  readonly error?: string | null;
};

// Проверка SSL-сертификата (если health_url по https). daysLeft < порога → ssl_expiry.
export type SslCheck = {
  readonly host: string;
  readonly daysLeft: number | null;
  readonly expiresAt: string | null;
  readonly error?: string | null;
};

export type SnapshotMetrics = {
  readonly pm2: ReadonlyArray<Pm2ProcessSnapshot>;
  readonly system: SystemSnapshot | null;
  readonly http?: HttpCheck | null;
  readonly ssl?: SslCheck | null;
};

export type SnapshotSource = 'local' | 'agent';

export type ServerSnapshot = {
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
  readonly errors: ReadonlyArray<string> | null;
  readonly createdAt: Date;
};

// Вынесенные числовые колонки (для дешёвых трендовых выборок и индексов).
export type SnapshotIndexColumns = {
  readonly cpuLoad1: number | null;
  readonly cpuLoad5: number | null;
  readonly cpuLoad15: number | null;
  readonly memUsedPct: number | null;
  readonly diskUsedPct: number | null;
  readonly pm2Online: number | null;
  readonly pm2RestartTotal: number | null;
};

// Чистая деривация числовых колонок из payload'а. Используется обоими путями записи
// снимка (local-collect и agent-ingest), чтобы трендовые колонки всегда были согласованы.
export function snapshotIndexColumns(metrics: SnapshotMetrics | null): SnapshotIndexColumns {
  if (!metrics) {
    return {
      cpuLoad1: null,
      cpuLoad5: null,
      cpuLoad15: null,
      memUsedPct: null,
      diskUsedPct: null,
      pm2Online: null,
      pm2RestartTotal: null,
    };
  }
  const maxDiskPct = metrics.system?.disks?.length
    ? Math.max(...metrics.system.disks.map((d) => d.usedPct))
    : null;
  return {
    cpuLoad1: metrics.system?.load1 ?? null,
    cpuLoad5: metrics.system?.load5 ?? null,
    cpuLoad15: metrics.system?.load15 ?? null,
    memUsedPct: metrics.system?.memUsedPct ?? null,
    diskUsedPct: maxDiskPct,
    pm2Online: metrics.pm2.filter((p) => p.status === 'online').length,
    pm2RestartTotal: metrics.pm2.reduce((sum, p) => sum + (p.restarts ?? 0), 0),
  };
}

// Простой health-status снимка (НЕ алерты — это отдельная подсистема). down при
// недоступности; degraded если есть не-online процессы или диск переполнен; иначе ok.
export function computeServerStatus(
  reachable: boolean,
  metrics: SnapshotMetrics | null,
  diskWarnPct = 90,
): ServerHealthStatus {
  if (!reachable) return 'down';
  if (!metrics) return 'unknown';
  const anyDown = metrics.pm2.some((p) => p.status !== 'online');
  const diskFull = (metrics.system?.disks ?? []).some((d) => d.usedPct >= diskWarnPct);
  if (anyDown || diskFull) return 'degraded';
  return 'ok';
}
