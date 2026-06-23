import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { projectMembers, projects, recentTaskViews, tasks } from '../db/schema.js';
import type { RecentTaskView } from '../../domain/task/RecentTaskView.js';
import type { TaskStatus } from '../../domain/task/Task.js';
import type { RecentTaskViewRepository } from '../../application/task/RecentTaskViewRepository.js';

// Описание задачи отдельного title-поля не имеет — берём первые N символов.
const EXCERPT_MAX = 80;

function toExcerpt(description: string | null): string {
  const text = (description ?? '').trim();
  if (text.length <= EXCERPT_MAX) return text;
  return `${text.slice(0, EXCERPT_MAX).trimEnd()}…`;
}

export class DrizzleRecentTaskViewRepository implements RecentTaskViewRepository {
  constructor(private readonly db: Database) {}

  async recordView(userId: string, taskId: string): Promise<void> {
    // Access-чек: задача существует И юзер — участник её проекта. Иначе тихо выходим
    // (не создаём запись для недоступной/чужой задачи).
    const rows = await this.db
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .innerJoin(
        projectMembers,
        and(eq(projectMembers.projectId, tasks.projectId), eq(projectMembers.userId, userId)),
      )
      .where(eq(tasks.id, taskId))
      .limit(1);
    const projectId = rows[0]?.projectId;
    if (!projectId) return;

    // Апсерт: одна строка на (user, task), повторное открытие бампит viewed_at.
    // CURRENT_TIMESTAMP (не VALUES(...)) — MariaDB-совместимо, без alias-синтаксиса.
    await this.db
      .insert(recentTaskViews)
      .values({ userId, taskId, projectId })
      .onDuplicateKeyUpdate({ set: { viewedAt: sql`CURRENT_TIMESTAMP` } });
  }

  async listRecent(userId: string, limit: number): Promise<RecentTaskView[]> {
    // INNER JOIN на project_members гейтит доступ (только проекты, где юзер участник) и
    // на tasks/projects — отсекает удалённые. Без фильтра по workspace (кросс-воркспейсно).
    const rows = await this.db
      .select({
        taskId: recentTaskViews.taskId,
        projectId: projects.id,
        projectName: projects.name,
        projectIcon: projects.icon,
        projectIsInbox: projects.isInbox,
        description: tasks.description,
        status: tasks.status,
        viewedAt: recentTaskViews.viewedAt,
      })
      .from(recentTaskViews)
      .innerJoin(tasks, eq(tasks.id, recentTaskViews.taskId))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .innerJoin(
        projectMembers,
        and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId)),
      )
      .where(eq(recentTaskViews.userId, userId))
      .orderBy(desc(recentTaskViews.viewedAt))
      .limit(limit);

    return rows.map((r) => ({
      taskId: r.taskId,
      projectId: r.projectId,
      projectName: r.projectName,
      projectIcon: r.projectIcon ?? null,
      projectIsInbox: r.projectIsInbox,
      taskExcerpt: toExcerpt(r.description),
      status: r.status as TaskStatus,
      viewedAt: r.viewedAt,
    }));
  }
}
