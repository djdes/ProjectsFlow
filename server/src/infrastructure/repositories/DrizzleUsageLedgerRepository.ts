import { and, asc, eq, gte, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { aiUsageLedger } from '../db/schema.js';
import type {
  RecordUsageRow,
  UsageLedgerRepository,
} from '../../application/usage/UsageLedgerRepository.js';

export class DrizzleUsageLedgerRepository implements UsageLedgerRepository {
  constructor(private readonly db: Database) {}

  async append(row: RecordUsageRow): Promise<boolean> {
    try {
      await this.db.insert(aiUsageLedger).values({
        id: row.id,
        userId: row.userId,
        source: row.source,
        refId: row.refId,
        projectId: row.projectId,
        model: row.model,
        tokensIn: row.tokensIn,
        tokensOut: row.tokensOut,
        // DECIMAL принимает строку.
        costUsd: String(row.costUsd),
        ...(row.occurredAt ? { occurredAt: row.occurredAt } : {}),
      });
      return true;
    } catch (e: unknown) {
      // Идемпотентность: повторный complete / двойной fire → строка уже есть, не дубль.
      if ((e as { code?: string }).code === 'ER_DUP_ENTRY') return false;
      throw e;
    }
  }

  async sumSince(userId: string, since: Date): Promise<number> {
    // SUM(DECIMAL) приходит строкой из mysql2 → Number(). COALESCE на случай 0 строк.
    const rows = await this.db
      .select({ s: sql<string>`COALESCE(SUM(${aiUsageLedger.costUsd}), 0)` })
      .from(aiUsageLedger)
      .where(and(eq(aiUsageLedger.userId, userId), gte(aiUsageLedger.occurredAt, since)));
    return Number(rows[0]?.s ?? 0);
  }

  async earliestSince(userId: string, since: Date): Promise<Date | null> {
    const rows = await this.db
      .select({ at: aiUsageLedger.occurredAt })
      .from(aiUsageLedger)
      .where(and(eq(aiUsageLedger.userId, userId), gte(aiUsageLedger.occurredAt, since)))
      .orderBy(asc(aiUsageLedger.occurredAt))
      .limit(1);
    return rows[0]?.at ?? null;
  }
}
