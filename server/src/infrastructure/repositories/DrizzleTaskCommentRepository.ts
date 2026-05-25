import { and, asc, count, eq, gte, inArray, like, type SQL } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { taskComments, type TaskCommentRow } from '../db/schema.js';
import type { TaskComment } from '../../domain/task/TaskComment.js';
import type {
  CreateTaskCommentInput,
  ListTaskCommentsFilters,
  TaskCommentRepository,
  UpdateTaskCommentInput,
} from '../../application/task/TaskCommentRepository.js';

// Эскейп для LIKE: `%` и `_` — wildcards; backslash — escape. Не даёт caller'у
// случайно/намеренно использовать wildcard'ы в markerSubstring.
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function toComment(row: TaskCommentRow): TaskComment {
  return {
    id: row.id,
    taskId: row.taskId,
    ownerUserId: row.ownerUserId,
    body: row.body,
    // Колонка NOT NULL DEFAULT 'user' — на старых строках вернётся 'user'. Cast: enum.
    actorKind: (row.actorKind as TaskComment['actorKind']) ?? 'user',
    agentName: row.agentName ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleTaskCommentRepository implements TaskCommentRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateTaskCommentInput): Promise<TaskComment> {
    await this.db.insert(taskComments).values({
      id: input.id,
      taskId: input.taskId,
      ownerUserId: input.ownerUserId,
      body: input.body,
      // Дефолт 'user' — соответствует SQL DEFAULT и историческим записям.
      actorKind: input.actorKind ?? 'user',
      agentName: input.agentName ?? null,
    });
    const fresh = await this.getById(input.id);
    if (!fresh) throw new Error('Failed to read back task comment after insert');
    return fresh;
  }

  async getById(commentId: string): Promise<TaskComment | null> {
    const rows = await this.db
      .select()
      .from(taskComments)
      .where(eq(taskComments.id, commentId))
      .limit(1);
    return rows[0] ? toComment(rows[0]) : null;
  }

  async listByTask(taskId: string): Promise<TaskComment[]> {
    const rows = await this.db
      .select()
      .from(taskComments)
      .where(eq(taskComments.taskId, taskId))
      .orderBy(asc(taskComments.createdAt));
    return rows.map(toComment);
  }

  async listByTaskFiltered(
    taskId: string,
    filters: ListTaskCommentsFilters,
  ): Promise<TaskComment[]> {
    const conditions: SQL[] = [eq(taskComments.taskId, taskId)];
    if (filters.since) conditions.push(gte(taskComments.createdAt, filters.since));
    if (filters.markerSubstring) {
      // Совпадает с любым ralph-маркером в body: '<!-- {marker}'. Эскейпим LIKE-метасимволы.
      conditions.push(like(taskComments.body, `%<!-- ${escapeLike(filters.markerSubstring)}%`));
    }
    const limit = Math.max(1, Math.min(500, filters.limit ?? 200));
    const rows = await this.db
      .select()
      .from(taskComments)
      .where(and(...conditions))
      .orderBy(asc(taskComments.createdAt))
      .limit(limit);
    return rows.map(toComment);
  }

  async update(input: UpdateTaskCommentInput): Promise<TaskComment | null> {
    await this.db
      .update(taskComments)
      .set({ body: input.body })
      .where(eq(taskComments.id, input.id));
    return this.getById(input.id);
  }

  async delete(commentId: string): Promise<boolean> {
    const result = await this.db.delete(taskComments).where(eq(taskComments.id, commentId));
    const affected = (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
    return affected > 0;
  }

  async deleteByTask(taskId: string): Promise<number> {
    const result = await this.db.delete(taskComments).where(eq(taskComments.taskId, taskId));
    return (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
  }

  async countsByTasks(taskIds: readonly string[]): Promise<ReadonlyMap<string, number>> {
    if (taskIds.length === 0) return new Map();
    const rows = await this.db
      .select({ taskId: taskComments.taskId, n: count() })
      .from(taskComments)
      .where(inArray(taskComments.taskId, [...taskIds]))
      .groupBy(taskComments.taskId);
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.taskId, Number(r.n));
    return m;
  }
}
