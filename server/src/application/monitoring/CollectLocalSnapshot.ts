import type { ServerRepository } from './ServerRepository.js';
import type { SnapshotRepository } from './SnapshotRepository.js';
import type { LocalServerCollector } from './LocalServerCollector.js';
import type { DbHealthProbe } from './DbHealthProbe.js';
import type { ProjectServer } from '../../domain/monitoring/ProjectServer.js';
import {
  computeServerStatus,
  type ServerSnapshot,
} from '../../domain/monitoring/ServerSnapshot.js';
import { redactSecrets } from '../../domain/monitoring/redactSecrets.js';
import type { LogTails, LogTail } from '../../domain/monitoring/ServerSnapshot.js';

type SnapshotStoredHook = (snapshot: ServerSnapshot, prev: ServerSnapshot | null) => void;

type Deps = {
  readonly servers: ServerRepository;
  readonly snapshots: SnapshotRepository;
  readonly collector: LocalServerCollector;
  readonly idGen: () => string;
  readonly now: () => Date;
  // TTL короткого кэша для on-demand чтения (анти-DoS на shell-out). По умолчанию 20с.
  readonly cacheTtlMs?: number;
  // Зонд метрик БД (MariaDB) — заполняет dbHealth для local-сервера. Optional.
  readonly dbHealthProbe?: DbHealthProbe;
  readonly onSnapshotStored?: SnapshotStoredHook;
};

// Сбор снимка для local-сервера: шеллит метрики, считает статус, пишет снимок, дёргает хук.
// Используется и периодическим интервалом (force), и on-demand роутом (через кэш).
export class CollectLocalSnapshot {
  private readonly cache = new Map<string, { at: number; snapshot: ServerSnapshot }>();

  constructor(private readonly deps: Deps) {}

  async collect(server: ProjectServer, opts?: { force?: boolean }): Promise<ServerSnapshot> {
    const ttl = this.deps.cacheTtlMs ?? 20_000;
    const nowMs = this.deps.now().getTime();
    const cached = this.cache.get(server.id);
    if (!opts?.force && cached && nowMs - cached.at < ttl) {
      return cached.snapshot;
    }

    const result = await this.deps.collector.collect(server);
    const metrics = result.metrics;
    const status = computeServerStatus(result.reachable, metrics);
    const collectedAt = this.deps.now();
    const prev = await this.deps.snapshots.getLatestBefore(server.id, collectedAt);
    const dbHealth = this.deps.dbHealthProbe
      ? await this.deps.dbHealthProbe.probe().catch(() => null)
      : null;

    const snapshot = await this.deps.snapshots.insert({
      id: this.deps.idGen(),
      serverId: server.id,
      projectId: server.projectId,
      collectedAt,
      source: 'local',
      status,
      reachable: result.reachable,
      metrics,
      // Серверная редакция секретов — defense in depth (collector тоже мог редактировать).
      logs: redactLogTails(result.logs),
      dbHealth,
      errors: result.errors.length > 0 ? result.errors : null,
      pushedByUserId: null,
      agentTokenId: null,
    });

    await this.deps.servers.updateLastSnapshot(server.id, collectedAt, status);
    this.cache.set(server.id, { at: nowMs, snapshot });
    this.deps.onSnapshotStored?.(snapshot, prev);
    return snapshot;
  }
}

function redactTail(t: LogTail | null): LogTail | null {
  if (!t || !t.available || !t.lines) return t;
  return { ...t, lines: redactSecrets(t.lines) };
}

export function redactLogTails(logs: LogTails | null): LogTails | null {
  if (!logs) return null;
  return {
    pm2Out: redactTail(logs.pm2Out),
    pm2Err: redactTail(logs.pm2Err),
    nginxAccess: redactTail(logs.nginxAccess),
    nginxError: redactTail(logs.nginxError),
  };
}
