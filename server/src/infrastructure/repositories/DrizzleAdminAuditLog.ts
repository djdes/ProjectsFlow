import { desc, eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { platformAdminAuditLog, users } from '../db/schema.js';
import { parseJsonCol } from './jsonCol.js';
import {
  ADMIN_AUDIT_ACTIONS,
  type AdminAuditAction,
  type AdminAuditDetail,
  type AdminAuditEntry,
  type AdminAuditInput,
  type AdminAuditLog,
} from '../../application/admin/AdminAuditLog.js';

const json = (value: AdminAuditDetail | null | undefined): string | null =>
  value && Object.keys(value).length > 0 ? JSON.stringify(value) : null;

// db/178. Insert-only: nothing in the code updates or deletes journal rows.
export class DrizzleAdminAuditLog implements AdminAuditLog {
  constructor(
    private readonly db: Database,
    private readonly idGen: () => string,
  ) {}

  async record(entries: readonly AdminAuditInput[]): Promise<void> {
    if (entries.length === 0) return;
    await this.db.insert(platformAdminAuditLog).values(entries.map((e) => ({
      id: this.idGen(),
      actorUserId: e.actorUserId,
      targetUserId: e.targetUserId,
      action: e.action,
      batchId: e.batchId ?? null,
      beforeJson: json(e.before),
      afterJson: json(e.after),
    })));
  }

  async listForTarget(targetUserId: string, limit: number): Promise<AdminAuditEntry[]> {
    const rows = await this.db
      .select({
        id: platformAdminAuditLog.id,
        actorUserId: platformAdminAuditLog.actorUserId,
        actorDisplayName: users.displayName,
        targetUserId: platformAdminAuditLog.targetUserId,
        action: platformAdminAuditLog.action,
        batchId: platformAdminAuditLog.batchId,
        beforeJson: platformAdminAuditLog.beforeJson,
        afterJson: platformAdminAuditLog.afterJson,
        createdAt: platformAdminAuditLog.createdAt,
      })
      .from(platformAdminAuditLog)
      .leftJoin(users, eq(users.id, platformAdminAuditLog.actorUserId))
      .where(eq(platformAdminAuditLog.targetUserId, targetUserId))
      .orderBy(desc(platformAdminAuditLog.seq))
      .limit(Math.max(1, Math.min(200, Math.floor(limit))));
    return rows
      .filter((r) => (ADMIN_AUDIT_ACTIONS as readonly string[]).includes(r.action))
      .map((r) => ({
        id: r.id,
        actorUserId: r.actorUserId,
        actorDisplayName: r.actorDisplayName ?? null,
        targetUserId: r.targetUserId ?? null,
        action: r.action as AdminAuditAction,
        batchId: r.batchId ?? null,
        before: parseJsonCol<AdminAuditDetail | null>(r.beforeJson, null),
        after: parseJsonCol<AdminAuditDetail | null>(r.afterJson, null),
        createdAt: r.createdAt,
      }));
  }
}
