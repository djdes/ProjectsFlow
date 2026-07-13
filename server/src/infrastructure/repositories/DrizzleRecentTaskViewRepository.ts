import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { projects, recentTaskViews, tasks } from '../db/schema.js';
import type { RecentTaskView } from '../../domain/task/RecentTaskView.js';
import type { TaskStatus } from '../../domain/task/Task.js';
import type { RecentTaskViewRepository } from '../../application/task/RecentTaskViewRepository.js';
// Access-check — через единое пространство (workspace_members, is_inbox→owner), НЕ
// project_members (#блокер5, отчёт fix-blockers-report.md) — переиспользуем
// ProjectMemberRepository (эталон DrizzleProjectMemberRepository).
import type { ProjectMemberRepository } from '../../application/project/ProjectMemberRepository.js';

// Описание задачи отдельного title-поля не имеет — берём первые N символов.
const EXCERPT_MAX = 80;

function toExcerpt(description: string | null): string {
  const text = (description ?? '').trim();
  if (text.length <= EXCERPT_MAX) return text;
  return `${text.slice(0, EXCERPT_MAX).trimEnd()}…`;
}

export class DrizzleRecentTaskViewRepository implements RecentTaskViewRepository {
  constructor(
    private readonly db: Database,
    private readonly projectMembers: ProjectMemberRepository,
  ) {}

  async recordView(userId: string, taskId: string): Promise<void> {
    // Access-чек: задача существует И юзер — участник её проекта через единое пространство
    // (findForProject: workspace_members + is_inbox→owner). Иначе тихо выходим (не создаём
    // запись для недоступной/чужой задачи). #блокер5: раньше гейтилось project_members —
    // ws-участник без ленивой строки тихо терял запись просмотра.
    const taskRows = await this.db
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    const projectId = taskRows[0]?.projectId;
    if (!projectId) return;

    const membership = await this.projectMembers.findForProject(projectId, userId);
    if (!membership) return;

    // Апсерт: одна строка на (user, task), повторное открытие бампит viewed_at.
    // CURRENT_TIMESTAMP (не VALUES(...)) — MariaDB-совместимо, без alias-синтаксиса.
    await this.db
      .insert(recentTaskViews)
      .values({ userId, taskId, projectId })
      .onDuplicateKeyUpdate({ set: { viewedAt: sql`CURRENT_TIMESTAMP` } });
  }

  async listRecent(userId: string, limit: number): Promise<RecentTaskView[]> {
    // Гейт доступа — через единое пространство (workspace_members, is_inbox→owner), НЕ
    // project_members (#блокер5: «Недавно просмотренные» были мертвы для ws-участника без
    // ленивой строки). Без фильтра по workspace (кросс-воркспейсно, как и раньше).
    const accessibleIds = (await this.projectMembers.listProjectsForUser(userId)).map(
      (p) => p.id,
    );
    if (accessibleIds.length === 0) return [];

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
      .where(and(eq(recentTaskViews.userId, userId), inArray(projects.id, accessibleIds)))
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
