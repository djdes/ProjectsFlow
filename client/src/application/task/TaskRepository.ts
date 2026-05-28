import type { RalphMode, Task, TaskStatus } from '@/domain/task/Task';
import type { TaskCommit } from '@/domain/task/TaskCommit';
import type { TaskAttachment } from '@/domain/task/TaskAttachment';
import type { TaskComment } from '@/domain/task/TaskComment';

export type CreateTaskInput = {
  readonly description: string;
  readonly status?: TaskStatus;
  // Режим работы Ralph. Если не передан — backend дефолтит 'normal'.
  readonly ralphMode?: RalphMode;
  // Опциональное one-to-one делегирование (только для inbox-задач). UUID юзера
  // из shared-members списка caller'а; null/undefined — обычная задача.
  readonly delegateUserId?: string | null;
};

export type UpdateTaskInput = {
  readonly description?: string;
  readonly ralphMode?: RalphMode;
};

export type MoveTaskInput = {
  readonly targetStatus: TaskStatus;
  readonly beforeTaskId: string | null;
  readonly afterTaskId: string | null;
};

export type SyncCommitsResult = {
  readonly linkedCount: number;
  readonly autoTransitionedCount: number;
  readonly scannedCount: number;
};

export interface TaskRepository {
  list(projectId: string): Promise<Task[]>;
  create(projectId: string, input: CreateTaskInput): Promise<Task>;
  update(projectId: string, taskId: string, input: UpdateTaskInput): Promise<Task>;
  move(projectId: string, taskId: string, input: MoveTaskInput): Promise<Task>;
  delete(projectId: string, taskId: string): Promise<void>;
  listCommits(projectId: string, taskId: string): Promise<TaskCommit[]>;
  linkCommit(projectId: string, taskId: string, sha: string): Promise<TaskCommit>;
  unlinkCommit(projectId: string, taskId: string, sha: string): Promise<void>;
  syncCommits(projectId: string): Promise<SyncCommitsResult>;
  listAttachments(projectId: string, taskId: string): Promise<TaskAttachment[]>;
  uploadAttachment(projectId: string, taskId: string, file: File): Promise<TaskAttachment>;
  deleteAttachment(projectId: string, taskId: string, attachmentId: string): Promise<void>;
  uploadCommentAttachment(
    projectId: string,
    taskId: string,
    commentId: string,
    file: File,
  ): Promise<TaskAttachment>;
  deleteCommentAttachment(
    projectId: string,
    taskId: string,
    commentId: string,
    attachmentId: string,
  ): Promise<void>;
  listComments(projectId: string, taskId: string): Promise<TaskComment[]>;
  createComment(projectId: string, taskId: string, body: string): Promise<TaskComment>;
  updateComment(
    projectId: string,
    taskId: string,
    commentId: string,
    body: string,
  ): Promise<TaskComment>;
  deleteComment(projectId: string, taskId: string, commentId: string): Promise<void>;
  // Запрос/отзыв отмены Ralph-работы (pull-based флаг, см. db/037).
  requestRalphCancel(projectId: string, taskId: string): Promise<Task>;
  revokeRalphCancel(projectId: string, taskId: string): Promise<Task>;
  // Перенос inbox-задачи в реальный проект. Активная делегация (если была) →
  // archived; делегат получает email + notification. Только creator (owner inbox).
  assignToProject(projectId: string, taskId: string, targetProjectId: string): Promise<Task>;
}
