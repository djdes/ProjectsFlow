import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { projectViews, users } from '../db/schema.js';
import type { ProjectAnalytics } from '../../domain/project/ProjectView.js';
import type { ProjectViewRepository } from '../../application/project/ProjectViewRepository.js';

const THROTTLE_MS = 30 * 60 * 1000; // не пишем повторный просмотр чаще раза в 30 мин

export class DrizzleProjectViewRepository implements ProjectViewRepository {
  constructor(private readonly db: Database) {}

  async recordView(userId: string, projectId: string): Promise<void> {
    // Дедуп: если тот же юзер смотрел проект в последние 30 мин — не пишем новую строку.
    const throttleCutoff = new Date(Date.now() - THROTTLE_MS);
    const recent = await this.db
      .select({ id: projectViews.id })
      .from(projectViews)
      .where(
        and(
          eq(projectViews.userId, userId),
          eq(projectViews.projectId, projectId),
          gte(projectViews.viewedAt, throttleCutoff),
        ),
      )
      .limit(1);
    if (recent.length > 0) return;
    await this.db.insert(projectViews).values({ id: randomUUID(), userId, projectId });
  }

  async getAnalytics(projectId: string, windowDays: number): Promise<ProjectAnalytics> {
    const windowCutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    // Просмотры по дням за окно (только непустые дни; клиент дозаполнит нули).
    const perDayRows = await this.db
      .select({
        date: sql<string>`DATE(${projectViews.viewedAt})`,
        count: sql<number>`COUNT(*)`,
        unique: sql<number>`COUNT(DISTINCT ${projectViews.userId})`,
      })
      .from(projectViews)
      .where(and(eq(projectViews.projectId, projectId), gte(projectViews.viewedAt, windowCutoff)))
      .groupBy(sql`DATE(${projectViews.viewedAt})`)
      .orderBy(sql`DATE(${projectViews.viewedAt})`);

    // Зрители за всё время: distinct юзеры с последним просмотром и числом заходов.
    const viewerRows = await this.db
      .select({
        userId: projectViews.userId,
        lastViewedAt: sql<string | Date>`MAX(${projectViews.viewedAt})`,
        viewCount: sql<number>`COUNT(*)`,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
      })
      .from(projectViews)
      .innerJoin(users, eq(users.id, projectViews.userId))
      .where(eq(projectViews.projectId, projectId))
      .groupBy(projectViews.userId, users.displayName, users.avatarUrl)
      .orderBy(desc(sql`MAX(${projectViews.viewedAt})`));

    const perDay = perDayRows.map((r) => ({
      date: String(r.date),
      count: Number(r.count),
      unique: Number(r.unique),
    }));
    const totalViews = perDay.reduce((s, r) => s + r.count, 0);

    return {
      totalViews,
      windowDays,
      perDay,
      viewers: viewerRows.map((r) => ({
        userId: r.userId,
        displayName: r.displayName,
        avatarUrl: r.avatarUrl ?? null,
        lastViewedAt: r.lastViewedAt instanceof Date ? r.lastViewedAt : new Date(r.lastViewedAt),
        viewCount: Number(r.viewCount),
      })),
    };
  }
}
