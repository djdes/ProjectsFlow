import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { taskAttachments, type TaskAttachmentRow } from '../db/schema.js';
import type { TaskAttachment } from '../../domain/task/TaskAttachment.js';
import type {
  CreateTaskAttachmentInput,
  TaskAttachmentRepository,
} from '../../application/task/TaskAttachmentRepository.js';

function toAttachment(row: TaskAttachmentRow): TaskAttachment {
  return {
    id: row.id,
    taskId: row.taskId,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    storageKey: row.storageKey,
    uploadedAt: row.uploadedAt,
  };
}

export class DrizzleTaskAttachmentRepository implements TaskAttachmentRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateTaskAttachmentInput): Promise<TaskAttachment> {
    await this.db.insert(taskAttachments).values({
      id: input.id,
      taskId: input.taskId,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      storageKey: input.storageKey,
    });
    const fresh = await this.getById(input.id);
    if (!fresh) throw new Error('Failed to read back attachment after insert');
    return fresh;
  }

  async getById(attachmentId: string): Promise<TaskAttachment | null> {
    const rows = await this.db
      .select()
      .from(taskAttachments)
      .where(eq(taskAttachments.id, attachmentId))
      .limit(1);
    return rows[0] ? toAttachment(rows[0]) : null;
  }

  async listByTask(taskId: string): Promise<TaskAttachment[]> {
    const rows = await this.db
      .select()
      .from(taskAttachments)
      .where(eq(taskAttachments.taskId, taskId))
      .orderBy(asc(taskAttachments.uploadedAt));
    return rows.map(toAttachment);
  }

  async countsByTasks(taskIds: string[]): Promise<Map<string, number>> {
    if (taskIds.length === 0) return new Map();
    const rows = await this.db
      .select({ taskId: taskAttachments.taskId, count: sql<number>`COUNT(*)` })
      .from(taskAttachments)
      .where(inArray(taskAttachments.taskId, taskIds))
      .groupBy(taskAttachments.taskId);
    const out = new Map<string, number>();
    for (const r of rows) out.set(r.taskId, Number(r.count));
    return out;
  }

  async delete(attachmentId: string): Promise<boolean> {
    const result = await this.db.delete(taskAttachments).where(eq(taskAttachments.id, attachmentId));
    const affected = (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
    return affected > 0;
  }

  async deleteByTask(taskId: string): Promise<number> {
    const result = await this.db.delete(taskAttachments).where(eq(taskAttachments.taskId, taskId));
    return (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
  }
}
