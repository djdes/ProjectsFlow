import { and, desc, eq, inArray, like, type SQL } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { projects, tasks } from '../db/schema.js';
import type { TaskStatus } from '../../domain/task/Task.js';
import type {
  TaskSearchQuery,
  TaskSearchRepository,
  TaskSearchResult,
} from '../../application/task/TaskSearchRepository.js';
// Скоуп «только мои проекты» — через единое пространство (workspace_members, is_inbox→owner),
// НЕ project_members (#блокер4) — переиспользуем ProjectMemberRepository (эталон
// DrizzleProjectMemberRepository).
import type { ProjectMemberRepository } from '../../application/project/ProjectMemberRepository.js';

const EXCERPT_MAX = 160;

// Экранируем спец-символы LIKE (% _ \), чтобы пользовательский ввод не превратился
// в wildcard. Backslash — дефолтный escape-char MySQL/MariaDB.
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function toExcerpt(description: string | null): string {
  const text = (description ?? '').trim();
  return text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX)}…` : text;
}

export class DrizzleTaskSearchRepository implements TaskSearchRepository {
  constructor(
    private readonly db: Database,
    private readonly projectMembers: ProjectMemberRepository,
  ) {}

  async search(q: TaskSearchQuery): Promise<TaskSearchResult[]> {
    const pattern = `%${escapeLike(q.query)}%`;
    const columns = {
      taskId: tasks.id,
      projectId: tasks.projectId,
      projectName: projects.name,
      status: tasks.status,
      description: tasks.description,
      createdAt: tasks.createdAt,
    };

    // Скоуп «только мои проекты» — через единое пространство (workspace_members,
    // is_inbox→owner), НЕ project_members (#блокер4: ws-участник без ленивой
    // project_members-строки получал 0 результатов). Без workspaceId — ВСЕ пространства
    // юзера, как и раньше (TaskSearchQuery не несёт workspaceId).
    let scopeCond: SQL | undefined;
    if (!q.includeAllProjects) {
      const accessibleIds = (await this.projectMembers.listProjectsForUser(q.userId)).map(
        (p) => p.id,
      );
      if (accessibleIds.length === 0) return [];
      scopeCond = inArray(tasks.projectId, accessibleIds);
    }

    const rows = await this.db
      .select(columns)
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(scopeCond ? and(like(tasks.description, pattern), scopeCond) : like(tasks.description, pattern))
      .orderBy(desc(tasks.updatedAt))
      .limit(q.limit);

    return rows.map((r) => ({
      taskId: r.taskId,
      projectId: r.projectId,
      projectName: r.projectName,
      status: r.status as TaskStatus,
      excerpt: toExcerpt(r.description),
      createdAt: r.createdAt,
    }));
  }
}
