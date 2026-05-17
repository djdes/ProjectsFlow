import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { taskCommits, type TaskCommitRow } from '../db/schema.js';
import type { TaskCommit } from '../../domain/task/TaskCommit.js';
import type {
  LinkCommitInput,
  TaskCommitRepository,
} from '../../application/task/TaskCommitRepository.js';

function toCommit(row: TaskCommitRow): TaskCommit {
  return {
    taskId: row.taskId,
    sha: row.sha,
    message: row.message,
    authorName: row.authorName,
    authorAvatarUrl: row.authorAvatarUrl ?? null,
    htmlUrl: row.htmlUrl,
    committedAt: row.committedAt,
    linkedAt: row.linkedAt,
  };
}

export class DrizzleTaskCommitRepository implements TaskCommitRepository {
  constructor(private readonly db: Database) {}

  async listByTask(taskId: string): Promise<TaskCommit[]> {
    const rows = await this.db
      .select()
      .from(taskCommits)
      .where(eq(taskCommits.taskId, taskId))
      .orderBy(desc(taskCommits.committedAt), asc(taskCommits.sha));
    return rows.map(toCommit);
  }

  async listByTasks(taskIds: readonly string[]): Promise<TaskCommit[]> {
    if (taskIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(taskCommits)
      .where(inArray(taskCommits.taskId, [...taskIds]))
      .orderBy(desc(taskCommits.committedAt));
    return rows.map(toCommit);
  }

  async link(input: LinkCommitInput): Promise<{ linked: boolean }> {
    // INSERT IGNORE — повторная привязка того же sha к той же задаче возвращает linked=false.
    const result = await this.db
      .insert(taskCommits)
      .values({
        taskId: input.taskId,
        sha: input.sha,
        message: input.message,
        authorName: input.authorName,
        authorAvatarUrl: input.authorAvatarUrl,
        htmlUrl: input.htmlUrl,
        committedAt: input.committedAt,
      })
      .onDuplicateKeyUpdate({
        // Re-link одного и того же — обновляем snapshot (на случай если message изменился, force-push).
        set: {
          message: input.message,
          authorName: input.authorName,
          authorAvatarUrl: input.authorAvatarUrl,
          htmlUrl: input.htmlUrl,
          committedAt: input.committedAt,
        },
      });
    // mysql2 returns affectedRows: 1 for INSERT, 2 for UPDATE on duplicate key.
    const affected = (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
    return { linked: affected === 1 };
  }

  async unlink(taskId: string, sha: string): Promise<boolean> {
    const result = await this.db
      .delete(taskCommits)
      .where(and(eq(taskCommits.taskId, taskId), eq(taskCommits.sha, sha)));
    const affected = (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
    return affected > 0;
  }

  async countByTask(taskId: string): Promise<number> {
    const rows = await this.db
      .select({ n: count() })
      .from(taskCommits)
      .where(eq(taskCommits.taskId, taskId));
    return Number(rows[0]?.n ?? 0);
  }

  async countsByTasks(taskIds: readonly string[]): Promise<ReadonlyMap<string, number>> {
    if (taskIds.length === 0) return new Map();
    const rows = await this.db
      .select({ taskId: taskCommits.taskId, n: count() })
      .from(taskCommits)
      .where(inArray(taskCommits.taskId, [...taskIds]))
      .groupBy(taskCommits.taskId);
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.taskId, Number(r.n));
    return m;
  }
}
