import type { TaskAttachment } from '../../domain/task/TaskAttachment.js';

export type CreateTaskAttachmentInput = {
  readonly id: string;
  readonly taskId: string;
  readonly commentId?: string | null;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly storageKey: string;
};

export interface TaskAttachmentRepository {
  create(input: CreateTaskAttachmentInput): Promise<TaskAttachment>;
  getById(attachmentId: string): Promise<TaskAttachment | null>;
  // Вложения самой задачи (comment_id IS NULL).
  listByTask(taskId: string): Promise<TaskAttachment[]>;
  // Вложения одного комментария.
  listByComment(commentId: string): Promise<TaskAttachment[]>;
  // Батч: map commentId → вложения (для ленты комментариев без N+1).
  listByCommentIds(commentIds: string[]): Promise<Map<string, TaskAttachment[]>>;
  // Возвращает map taskId → counts для отдачи в `ListTasks` (бейдж в карточке).
  // Считаем только вложения задачи (comment_id IS NULL).
  countsByTasks(taskIds: string[]): Promise<Map<string, number>>;
  delete(attachmentId: string): Promise<boolean>;
  deleteByTask(taskId: string): Promise<number>;
}
