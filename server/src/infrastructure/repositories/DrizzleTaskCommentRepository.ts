import { asc, eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { taskComments, type TaskCommentRow } from '../db/schema.js';
import type { TaskComment } from '../../domain/task/TaskComment.js';
import type {
  CreateTaskCommentInput,
  TaskCommentRepository,
  UpdateTaskCommentInput,
} from '../../application/task/TaskCommentRepository.js';

function toComment(row: TaskCommentRow): TaskComment {
  return {
    id: row.id,
    taskId: row.taskId,
    ownerUserId: row.ownerUserId,
    body: row.body,
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
}
