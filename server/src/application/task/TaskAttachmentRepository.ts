import type { TaskAttachment } from '../../domain/task/TaskAttachment.js';

export type CreateTaskAttachmentInput = {
  readonly id: string;
  readonly taskId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly storageKey: string;
};

export interface TaskAttachmentRepository {
  create(input: CreateTaskAttachmentInput): Promise<TaskAttachment>;
  getById(attachmentId: string): Promise<TaskAttachment | null>;
  listByTask(taskId: string): Promise<TaskAttachment[]>;
  // Возвращает map taskId → counts для отдачи в `ListTasks` (бейдж в карточке).
  countsByTasks(taskIds: string[]): Promise<Map<string, number>>;
  delete(attachmentId: string): Promise<boolean>;
  deleteByTask(taskId: string): Promise<number>;
}
