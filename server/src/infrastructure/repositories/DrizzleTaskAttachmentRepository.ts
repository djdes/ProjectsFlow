import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { taskAttachments, tasks, type TaskAttachmentRow } from '../db/schema.js';
import type { TaskAttachment } from '../../domain/task/TaskAttachment.js';
import type {
  CreateTaskAttachmentInput,
  TaskAttachmentRepository,
} from '../../application/task/TaskAttachmentRepository.js';

function toAttachment(row: TaskAttachmentRow): TaskAttachment {
  return {
    id: row.id,
    taskId: row.taskId,
    commentId: row.commentId ?? null,
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
      commentId: input.commentId ?? null,
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
      .where(and(eq(taskAttachments.taskId, taskId), isNull(taskAttachments.commentId)))
      .orderBy(asc(taskAttachments.uploadedAt));
    return rows.map(toAttachment);
  }

  async listByComment(commentId: string): Promise<TaskAttachment[]> {
    const rows = await this.db
      .select()
      .from(taskAttachments)
      .where(eq(taskAttachments.commentId, commentId))
      .orderBy(asc(taskAttachments.uploadedAt));
    return rows.map(toAttachment);
  }

  async listByCommentIds(commentIds: string[]): Promise<Map<string, TaskAttachment[]>> {
    const out = new Map<string, TaskAttachment[]>();
    if (commentIds.length === 0) return out;
    const rows = await this.db
      .select()
      .from(taskAttachments)
      .where(inArray(taskAttachments.commentId, commentIds))
      .orderBy(asc(taskAttachments.uploadedAt));
    for (const row of rows) {
      const att = toAttachment(row);
      if (!att.commentId) continue;
      const list = out.get(att.commentId) ?? [];
      list.push(att);
      out.set(att.commentId, list);
    }
    return out;
  }

  async countsByTasks(taskIds: string[]): Promise<Map<string, number>> {
    if (taskIds.length === 0) return new Map();
    const rows = await this.db
      .select({ taskId: taskAttachments.taskId, count: sql<number>`COUNT(*)` })
      .from(taskAttachments)
      .where(and(inArray(taskAttachments.taskId, taskIds), isNull(taskAttachments.commentId)))
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

  async listStorageKeysByProject(projectId: string): Promise<string[]> {
    // INNER JOIN с tasks: аттач существует только если его task ещё в БД.
    // БЕЗ фильтра deleted_at (db/134) намеренно: сносим проект целиком, файлы задач
    // из корзины тоже надо убрать с диска — иначе они переживут проект мусором.
    // Используется DeleteProject use-case'ом ДО каскадного удаления, чтобы потом
    // best-effort удалить файлы с диска (DB-каскад только убирает ROW'ы).
    const rows = await this.db
      .select({ storageKey: taskAttachments.storageKey })
      .from(taskAttachments)
      .innerJoin(tasks, eq(tasks.id, taskAttachments.taskId))
      .where(eq(tasks.projectId, projectId));
    return rows.map((r) => r.storageKey);
  }
}
