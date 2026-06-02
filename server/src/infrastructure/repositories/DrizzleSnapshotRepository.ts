import { and, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { serverSnapshots, type ServerSnapshotRow } from '../db/schema.js';
import type {
  HistoryQuery,
  NewSnapshotInput,
  SnapshotRepository,
  TrendPoint,
} from '../../application/monitoring/SnapshotRepository.js';
import {
  snapshotIndexColumns,
  type DbHealth,
  type LogTails,
  type ServerHealthStatus,
  type ServerSnapshot,
  type SnapshotMetrics,
} from '../../domain/monitoring/ServerSnapshot.js';
import { parseJsonCol } from './jsonCol.js';

function toSnapshot(r: ServerSnapshotRow): ServerSnapshot {
  return {
    id: r.id,
    serverId: r.serverId,
    projectId: r.projectId,
    collectedAt: r.collectedAt,
    source: r.source,
    status: r.status as ServerHealthStatus,
    reachable: r.reachable,
    metrics: parseJsonCol<SnapshotMetrics | null>(r.metrics, null),
    logs: parseJsonCol<LogTails | null>(r.logs, null),
    dbHealth: parseJsonCol<DbHealth | null>(r.dbHealth, null),
    errors: parseJsonCol<string[] | null>(r.errors, null),
    createdAt: r.createdAt,
  };
}

export class DrizzleSnapshotRepository implements SnapshotRepository {
  constructor(private readonly db: Database) {}

  async insert(input: NewSnapshotInput): Promise<ServerSnapshot> {
    const idx = snapshotIndexColumns(input.metrics);
    await this.db.insert(serverSnapshots).values({
      id: input.id,
      serverId: input.serverId,
      projectId: input.projectId,
      collectedAt: input.collectedAt,
      source: input.source,
      status: input.status,
      reachable: input.reachable,
      metrics: input.metrics,
      logs: input.logs,
      dbHealth: input.dbHealth,
      errors: input.errors,
      cpuLoad1: idx.cpuLoad1,
      cpuLoad5: idx.cpuLoad5,
      cpuLoad15: idx.cpuLoad15,
      memUsedPct: idx.memUsedPct,
      diskUsedPct: idx.diskUsedPct,
      pm2Online: idx.pm2Online,
      pm2RestartTotal: idx.pm2RestartTotal,
      pushedByUserId: input.pushedByUserId,
      agentTokenId: input.agentTokenId,
    });
    const [row] = await this.db
      .select()
      .from(serverSnapshots)
      .where(eq(serverSnapshots.id, input.id))
      .limit(1);
    if (!row) throw new Error(`server_snapshots row ${input.id} disappeared after insert`);
    return toSnapshot(row);
  }

  async getLatest(serverId: string): Promise<ServerSnapshot | null> {
    const [row] = await this.db
      .select()
      .from(serverSnapshots)
      .where(eq(serverSnapshots.serverId, serverId))
      .orderBy(desc(serverSnapshots.collectedAt))
      .limit(1);
    return row ? toSnapshot(row) : null;
  }

  async getLatestBefore(serverId: string, before: Date): Promise<ServerSnapshot | null> {
    const [row] = await this.db
      .select()
      .from(serverSnapshots)
      .where(and(eq(serverSnapshots.serverId, serverId), lt(serverSnapshots.collectedAt, before)))
      .orderBy(desc(serverSnapshots.collectedAt))
      .limit(1);
    return row ? toSnapshot(row) : null;
  }

  async listLatestPerServer(projectId: string): Promise<Map<string, ServerSnapshot>> {
    const maxRows = await this.db
      .select({
        serverId: serverSnapshots.serverId,
        mx: sql<Date>`MAX(${serverSnapshots.collectedAt})`,
      })
      .from(serverSnapshots)
      .where(eq(serverSnapshots.projectId, projectId))
      .groupBy(serverSnapshots.serverId);

    const map = new Map<string, ServerSnapshot>();
    for (const r of maxRows) {
      const [row] = await this.db
        .select()
        .from(serverSnapshots)
        .where(and(eq(serverSnapshots.serverId, r.serverId), eq(serverSnapshots.collectedAt, r.mx)))
        .limit(1);
      if (row) map.set(r.serverId, toSnapshot(row));
    }
    return map;
  }

  async getHistory(serverId: string, query: HistoryQuery): Promise<TrendPoint[]> {
    const conds = [eq(serverSnapshots.serverId, serverId)];
    if (query.since) conds.push(gte(serverSnapshots.collectedAt, query.since));
    if (query.until) conds.push(lte(serverSnapshots.collectedAt, query.until));
    const rows = await this.db
      .select({
        collectedAt: serverSnapshots.collectedAt,
        status: serverSnapshots.status,
        cpuLoad1: serverSnapshots.cpuLoad1,
        memUsedPct: serverSnapshots.memUsedPct,
        diskUsedPct: serverSnapshots.diskUsedPct,
        pm2Online: serverSnapshots.pm2Online,
        pm2RestartTotal: serverSnapshots.pm2RestartTotal,
      })
      .from(serverSnapshots)
      .where(and(...conds))
      .orderBy(serverSnapshots.collectedAt)
      .limit(query.limit);
    return rows.map((r) => ({
      collectedAt: r.collectedAt,
      status: r.status,
      cpuLoad1: r.cpuLoad1 ?? null,
      memUsedPct: r.memUsedPct ?? null,
      diskUsedPct: r.diskUsedPct ?? null,
      pm2Online: r.pm2Online ?? null,
      pm2RestartTotal: r.pm2RestartTotal ?? null,
    }));
  }

  async pruneOlderThan(cutoff: Date, _limit: number): Promise<number> {
    const res = await this.db
      .delete(serverSnapshots)
      .where(lt(serverSnapshots.collectedAt, cutoff));
    const header = Array.isArray(res) ? res[0] : res;
    return (header as { affectedRows?: number } | undefined)?.affectedRows ?? 0;
  }
}
