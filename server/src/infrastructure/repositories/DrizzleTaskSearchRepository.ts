import { and, desc, eq, like } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { projectMembers, projects, tasks } from '../db/schema.js';
import type { TaskStatus } from '../../domain/task/Task.js';
import type {
  TaskSearchQuery,
  TaskSearchRepository,
  TaskSearchResult,
} from '../../application/task/TaskSearchRepository.js';

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
  constructor(private readonly db: Database) {}

  async search(q: TaskSearchQuery): Promise<TaskSearchResult[]> {
    const pattern = `%${escapeLike(q.query)}%`;
    const columns = {
      taskId: tasks.id,
      projectId: tasks.projectId,
      projectName: projects.name,
      status: tasks.status,
      description: tasks.description,
    };

    const rows = q.includeAllProjects
      ? await this.db
          .select(columns)
          .from(tasks)
          .innerJoin(projects, eq(projects.id, tasks.projectId))
          .where(like(tasks.description, pattern))
          .orderBy(desc(tasks.updatedAt))
          .limit(q.limit)
      : await this.db
          .select(columns)
          .from(tasks)
          .innerJoin(projects, eq(projects.id, tasks.projectId))
          .innerJoin(
            projectMembers,
            and(
              eq(projectMembers.projectId, projects.id),
              eq(projectMembers.userId, q.userId),
            ),
          )
          .where(like(tasks.description, pattern))
          .orderBy(desc(tasks.updatedAt))
          .limit(q.limit);

    return rows.map((r) => ({
      taskId: r.taskId,
      projectId: r.projectId,
      projectName: r.projectName,
      status: r.status as TaskStatus,
      excerpt: toExcerpt(r.description),
    }));
  }
}
