import { sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import type {
  DailyCounts,
  PlatformStatsRepository,
  PlatformTotals,
} from '../../application/admin/PlatformStatsRepository.js';

// День по Москве (UTC+3, без летнего времени): соединение работает в UTC.
const day = (col: SQL): SQL => sql`DATE_FORMAT(DATE_ADD(${col}, INTERVAL 3 HOUR), '%Y-%m-%d')`;
// Начало периода: полночь fromDay по Москве, выраженная в UTC.
const since = (fromDay: string): SQL => sql`DATE_SUB(${`${fromDay} 00:00:00`}, INTERVAL 3 HOUR)`;

type Row = { d: string; n: number | string };

// Активность пользователя — любое из: открыл проект, вошёл, создал задачу, написал комментарий.
const activity = (from: SQL): SQL => sql`
  SELECT user_id, viewed_at AS at FROM project_views WHERE viewed_at >= ${from}
  UNION ALL SELECT user_id, created_at FROM sessions WHERE created_at >= ${from}
  UNION ALL SELECT created_by, created_at FROM tasks WHERE created_at >= ${from} AND created_by IS NOT NULL
  UNION ALL SELECT owner_user_id, created_at FROM task_comments WHERE created_at >= ${from} AND actor_kind = 'user'`;

export class DrizzlePlatformStatsRepository implements PlatformStatsRepository {
  constructor(private readonly db: Database) {}

  private async daily(query: SQL): Promise<DailyCounts> {
    const result = await this.db.execute(query);
    const rows = result[0] as unknown as Row[];
    return new Map(rows.map((r) => [String(r.d), Number(r.n)]));
  }

  registrationsByDay(fromDay: string): Promise<DailyCounts> {
    return this.daily(sql`
      SELECT ${day(sql`created_at`)} AS d, COUNT(*) AS n FROM users
      WHERE created_at >= ${since(fromDay)} GROUP BY d`);
  }

  activeUsersByDay(fromDay: string): Promise<DailyCounts> {
    return this.daily(sql`
      SELECT ${day(sql`at`)} AS d, COUNT(DISTINCT user_id) AS n
      FROM (${activity(since(fromDay))}) AS activity GROUP BY d`);
  }

  tasksCreatedByDay(fromDay: string): Promise<DailyCounts> {
    return this.daily(sql`
      SELECT ${day(sql`created_at`)} AS d, COUNT(*) AS n FROM tasks
      WHERE created_at >= ${since(fromDay)} GROUP BY d`);
  }

  commentsByDay(fromDay: string): Promise<DailyCounts> {
    return this.daily(sql`
      SELECT ${day(sql`created_at`)} AS d, COUNT(*) AS n FROM task_comments
      WHERE created_at >= ${since(fromDay)} AND actor_kind = 'user' GROUP BY d`);
  }

  async totals(now: Date): Promise<PlatformTotals> {
    const ago = (days: number): SQL => sql`DATE_SUB(${now}, INTERVAL ${days} DAY)`;
    const active = (days: number): SQL =>
      sql`(SELECT COUNT(DISTINCT user_id) FROM (${activity(ago(days))}) AS a)`;
    const result = await this.db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL) AS users,
        (SELECT COUNT(*) FROM workspaces) AS workspaces,
        (SELECT COUNT(*) FROM projects WHERE is_inbox = 0) AS projects,
        (SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL) AS tasks,
        (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND plan <> 'free'
          AND (subscription_expires_at IS NULL OR subscription_expires_at > ${now})) AS paidUsers,
        ${active(7)} AS activeWeek,
        ${active(30)} AS activeMonth`);
    const row = (result[0] as unknown as Array<Record<string, number | string>>)[0] ?? {};
    const n = (k: string): number => Number(row[k] ?? 0);
    return {
      users: n('users'),
      workspaces: n('workspaces'),
      projects: n('projects'),
      tasks: n('tasks'),
      paidUsers: n('paidUsers'),
      activeWeek: n('activeWeek'),
      activeMonth: n('activeMonth'),
    };
  }
}
