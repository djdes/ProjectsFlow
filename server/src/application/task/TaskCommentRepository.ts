import type { TaskComment } from '../../domain/task/TaskComment.js';

export type CreateTaskCommentInput = {
  readonly id: string;
  readonly taskId: string;
  readonly ownerUserId: string;
  readonly body: string;
};

export type UpdateTaskCommentInput = {
  readonly id: string;
  readonly body: string;
};

export interface TaskCommentRepository {
  create(input: CreateTaskCommentInput): Promise<TaskComment>;
  getById(commentId: string): Promise<TaskComment | null>;
  // Старые сверху, новые снизу — как чат.
  listByTask(taskId: string): Promise<TaskComment[]>;
  update(input: UpdateTaskCommentInput): Promise<TaskComment | null>;
  delete(commentId: string): Promise<boolean>;
  // Чистка при удалении задачи — чтоб не оставались висячие comment-строки.
  deleteByTask(taskId: string): Promise<number>;
}
