import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { appAdminAuditLog } from '../db/schema.js';
import { parseJsonCol } from './jsonCol.js';
import type { AppAdminAuditRepository } from '../../application/app-backend/AppAdminAuditRepository.js';
import type {
  AppAuditEntry,
  AppAuditInput,
  AppAuditListOpts,
} from '../../application/app-backend/AppDatabaseStore.js';

type Row = typeof appAdminAuditLog.$inferSelect;

function clampInt(v: number | undefined, min: number, max: number, dflt: number): number {
  if (v === undefined || !Number.isFinite(v)) return dflt;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

function toEntry(row: Row): AppAuditEntry {
  return {
    id: row.id,
    actorType: row.actorType as AppAuditEntry['actorType'],
    actorId: row.actorId ?? null,
    operation: row.operation,
    tableName: row.tableName ?? null,
    rowId: row.rowId ?? null,
    success: row.success === 1,
    detail: parseJsonCol<Readonly<Record<string, unknown>> | null>(row.detailJson, null),
    createdAt: row.createdAt,
  };
}

// Надёжный журнал административного аудита в MariaDB (db/136). Реализация порта
// AppAdminAuditRepository: append-only запись + чтение с фильтрами/пагинацией.
export class DrizzleAppAdminAuditRepository implements AppAdminAuditRepository {
  constructor(
    private readonly db: Database,
    private readonly idGen: () => string,
  ) {}

  async record(projectId: string, input: AppAuditInput): Promise<AppAuditEntry> {
    const entry: AppAuditEntry = {
      id: this.idGen(),
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      operation: input.operation.slice(0, 80),
      tableName: input.tableName ?? null,
      rowId: input.rowId ?? null,
      success: input.success !== false,
      detail: input.detail ?? null,
      createdAt: new Date().toISOString(),
    };
    await this.db.insert(appAdminAuditLog).values({
      id: entry.id,
      projectId,
      actorType: entry.actorType,
      actorId: entry.actorId,
      operation: entry.operation,
      tableName: entry.tableName,
      rowId: entry.rowId ? String(entry.rowId).slice(0, 128) : null,
      success: entry.success ? 1 : 0,
      detailJson: entry.detail ? JSON.stringify(entry.detail) : null,
      createdAt: entry.createdAt,
    });
    return entry;
  }

  async list(
    projectId: string,
    opts: AppAuditListOpts = {},
  ): Promise<{ rows: AppAuditEntry[]; total: number }> {
    const conds: SQL[] = [eq(appAdminAuditLog.projectId, projectId)];
    if (opts.tableName) conds.push(eq(appAdminAuditLog.tableName, opts.tableName));
    if (opts.operation) conds.push(eq(appAdminAuditLog.operation, opts.operation));
    if (opts.actorId) conds.push(eq(appAdminAuditLog.actorId, opts.actorId));
    if (opts.errorsOnly) conds.push(eq(appAdminAuditLog.success, 0));
    const where = and(...conds);

    const limit = clampInt(opts.limit, 1, 2000, 100);
    const offset = clampInt(opts.offset, 0, 1_000_000, 0);

    const totalRows = await this.db
      .select({ total: sql<number>`COUNT(*)` })
      .from(appAdminAuditLog)
      .where(where);
    const total = Number(totalRows[0]?.total ?? 0);

    // seq (AUTO_INCREMENT) — монотонный порядок вставки: надёжный tiebreak при равных created_at.
    const rows = await this.db
      .select()
      .from(appAdminAuditLog)
      .where(where)
      .orderBy(desc(appAdminAuditLog.seq))
      .limit(limit)
      .offset(offset);

    return { total, rows: rows.map(toEntry) };
  }
}
