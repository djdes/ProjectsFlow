import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { serverAlerts, type ServerAlertRow } from '../db/schema.js';
import type { MonitoringAlertRepository } from '../../application/monitoring/MonitoringAlertRepository.js';
import type { AlertKind, AlertSeverity, ServerAlert } from '../../domain/monitoring/Alert.js';
import { parseJsonCol } from './jsonCol.js';

function toAlert(r: ServerAlertRow): ServerAlert {
  return {
    id: r.id,
    serverId: r.serverId,
    projectId: r.projectId,
    ruleKind: r.ruleKind as AlertKind,
    dedupKey: r.dedupKey,
    severity: r.severity as AlertSeverity,
    status: r.status,
    message: r.message,
    details: parseJsonCol<Record<string, unknown> | null>(r.details, null),
    firstSeenAt: r.firstSeenAt,
    lastSeenAt: r.lastSeenAt,
    resolvedAt: r.resolvedAt ?? null,
    lastNotifiedAt: r.lastNotifiedAt ?? null,
    createdAt: r.createdAt,
  };
}

export class DrizzleMonitoringAlertRepository implements MonitoringAlertRepository {
  constructor(private readonly db: Database) {}

  async listActiveByServer(serverId: string): Promise<ServerAlert[]> {
    const rows = await this.db
      .select()
      .from(serverAlerts)
      .where(and(eq(serverAlerts.serverId, serverId), eq(serverAlerts.status, 'firing')));
    return rows.map(toAlert);
  }

  async listActiveByProject(projectId: string): Promise<ServerAlert[]> {
    const rows = await this.db
      .select()
      .from(serverAlerts)
      .where(and(eq(serverAlerts.projectId, projectId), eq(serverAlerts.status, 'firing')))
      .orderBy(desc(serverAlerts.lastSeenAt));
    return rows.map(toAlert);
  }

  async listByProject(projectId: string, limit: number): Promise<ServerAlert[]> {
    const rows = await this.db
      .select()
      .from(serverAlerts)
      .where(eq(serverAlerts.projectId, projectId))
      .orderBy(desc(serverAlerts.lastSeenAt))
      .limit(limit);
    return rows.map(toAlert);
  }

  async insert(alert: ServerAlert): Promise<void> {
    await this.db.insert(serverAlerts).values({
      id: alert.id,
      serverId: alert.serverId,
      projectId: alert.projectId,
      ruleKind: alert.ruleKind,
      dedupKey: alert.dedupKey,
      // active_dedup = dedupKey пока firing (партиальный UNIQUE по активным).
      activeDedup: alert.dedupKey,
      severity: alert.severity,
      status: alert.status,
      message: alert.message,
      details: alert.details,
      firstSeenAt: alert.firstSeenAt,
      lastSeenAt: alert.lastSeenAt,
      resolvedAt: alert.resolvedAt,
      lastNotifiedAt: alert.lastNotifiedAt,
    });
  }

  async touchLastSeen(id: string, at: Date): Promise<void> {
    await this.db.update(serverAlerts).set({ lastSeenAt: at }).where(eq(serverAlerts.id, id));
  }

  async markNotified(id: string, at: Date): Promise<void> {
    await this.db.update(serverAlerts).set({ lastNotifiedAt: at }).where(eq(serverAlerts.id, id));
  }

  async resolve(id: string, at: Date): Promise<void> {
    // active_dedup → NULL: освобождает ключ под новый firing, не конфликтует с историей.
    await this.db
      .update(serverAlerts)
      .set({ status: 'resolved', resolvedAt: at, lastSeenAt: at, activeDedup: null })
      .where(eq(serverAlerts.id, id));
  }
}
