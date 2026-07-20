import { and, eq, gte, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { appPageVisits } from '../db/schema.js';
import type {
  AppTrafficAggregate,
  AppTrafficRepository,
  AppVisitRecord,
} from '../../application/app-backend/AppTrafficRepository.js';
import type { UaClass } from '../../domain/app-backend/AppTraffic.js';

// Реализация порта AppTrafficRepository в MariaDB (db/137). Только агрегируемое чтение —
// временные ряды и грубые корзины; session_hash наружу из репозитория не отдаётся.
export class DrizzleAppTrafficRepository implements AppTrafficRepository {
  constructor(private readonly db: Database) {}

  async record(visit: AppVisitRecord): Promise<void> {
    await this.db.insert(appPageVisits).values({
      projectId: visit.projectId,
      path: visit.path.slice(0, 512),
      sessionHash: visit.sessionHash.slice(0, 64),
      userAgentClass: visit.userAgentClass,
      visitDay: visit.visitDay.slice(0, 10),
      createdAt: visit.createdAt.slice(0, 32),
    });
  }

  async countForDay(projectId: string, visitDay: string): Promise<number> {
    const rows = await this.db
      .select({ total: sql<number>`COUNT(*)` })
      .from(appPageVisits)
      .where(and(eq(appPageVisits.projectId, projectId), eq(appPageVisits.visitDay, visitDay)));
    return Number(rows[0]?.total ?? 0);
  }

  async aggregate(projectId: string, sinceDay: string): Promise<AppTrafficAggregate> {
    const where: SQL = and(
      eq(appPageVisits.projectId, projectId),
      gte(appPageVisits.visitDay, sinceDay),
    )!;

    const perDayRows = await this.db
      .select({
        date: appPageVisits.visitDay,
        visits: sql<number>`COUNT(*)`,
        sessions: sql<number>`COUNT(DISTINCT ${appPageVisits.sessionHash})`,
      })
      .from(appPageVisits)
      .where(where)
      .groupBy(appPageVisits.visitDay)
      .orderBy(appPageVisits.visitDay);

    const classRows = await this.db
      .select({ cls: appPageVisits.userAgentClass, count: sql<number>`COUNT(*)` })
      .from(appPageVisits)
      .where(where)
      .groupBy(appPageVisits.userAgentClass);

    const totalsRows = await this.db
      .select({
        totalVisits: sql<number>`COUNT(*)`,
        totalSessions: sql<number>`COUNT(DISTINCT ${appPageVisits.sessionHash})`,
      })
      .from(appPageVisits)
      .where(where);

    const byClass: Partial<Record<UaClass, number>> = {};
    for (const row of classRows) byClass[row.cls as UaClass] = Number(row.count);

    return {
      perDay: perDayRows.map((row) => ({
        date: row.date,
        visits: Number(row.visits),
        sessions: Number(row.sessions),
      })),
      byClass,
      totalVisits: Number(totalsRows[0]?.totalVisits ?? 0),
      totalSessions: Number(totalsRows[0]?.totalSessions ?? 0),
    };
  }
}
