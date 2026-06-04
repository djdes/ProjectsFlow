import type { RalphMode, Task, TaskPriority, TaskStatus } from '@/domain/task/Task';
import type { TaskCommit } from '@/domain/task/TaskCommit';
import type { TaskAttachment } from '@/domain/task/TaskAttachment';
import type {
  CommentNotifications,
  NotifyAudience,
  TaskComment,
} from '@/domain/task/TaskComment';

export type CreateTaskInput = {
  readonly description: string;
  readonly status?: TaskStatus;
  // Режим работы Ralph. Если не передан — backend дефолтит 'normal'.
  readonly ralphMode?: RalphMode;
  // Опциональное one-to-one делегирование (только для inbox-задач). UUID юзера
  // из shared-members списка caller'а; null/undefined — обычная задача.
  readonly delegateUserId?: string | null;
  // Срок выполнения 'YYYY-MM-DD'. null = без deadline.
  readonly deadline?: string | null;
  // Приоритет 1..4 (1=urgent, 4=low). null = без приоритета.
  readonly priority?: TaskPriority | null;
};

export type UpdateTaskInput = {
  readonly description?: string;
  readonly ralphMode?: RalphMode;
  // null = очистить deadline; undefined = не менять.
  readonly deadline?: string | null;
  // null = убрать приоритет; undefined = не менять.
  readonly priority?: TaskPriority | null;
};

export type MoveTaskInput = {
  readonly targetStatus: TaskStatus;
  readonly beforeTaskId: string | null;
  readonly afterTaskId: string | null;
  // Снятие галочки «выполнено»: вернуть прежний статус (status_before_done) — сервер
  // сам резолвит цель, targetStatus игнорируется. См. db/055, server MoveTask.
  readonly restore?: boolean;
};

export type SyncCommitsResult = {
  readonly linkedCount: number;
  readonly autoTransitionedCount: number;
  readonly scannedCount: number;
};

// === Экспорт-дайджест выбранных задач (буфер / email / Telegram) ===
export type DigestChannel = 'clipboard' | 'email' | 'telegram';
export type DigestRecipient =
  | { readonly kind: 'self' }
  | { readonly kind: 'user'; readonly userId: string }
  // Telegram-группа проекта (chat_id из настроек). Только для channel='telegram'.
  | { readonly kind: 'group' };
export type TaskDigestInput = {
  readonly taskIds: string[];
  readonly channel: DigestChannel;
  // Обязателен для email/telegram; для clipboard игнорируется.
  readonly recipients?: DigestRecipient[];
};
export type TaskDigestResult = {
  // Plain-text дайджест (для буфера; для email/telegram тоже возвращается).
  readonly text: string;
  readonly delivery?: {
    readonly delivered: { userId: string; channel: string }[];
    readonly skipped: { userId: string; reason: string }[];
  };
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
  // notify — адресация уведомления из композера (по умолчанию все участники).
  createComment(
    projectId: string,
    taskId: string,
    body: string,
    notify?: NotifyAudience,
  ): Promise<TaskComment>;
  // Журнал доставки уведомлений по комментарию — для меню ⋮ «Кто уведомлён».
  listCommentNotifications(
    projectId: string,
    taskId: string,
    commentId: string,
  ): Promise<CommentNotifications>;
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
  // Делегировать уже созданную inbox-задачу (UI «Делегировать» на карточке).
  // delegateUserId должен быть в shared-members caller'а; задача должна быть inbox
  // и без активной делегации.
  delegate(projectId: string, taskId: string, delegateUserId: string): Promise<Task>;
  // Экспорт выбранных задач в дайджест: вернуть текст (буфер) и/или отправить
  // на email / в Telegram. Сервер рендерит из авторитетных данных.
  digest(projectId: string, input: TaskDigestInput): Promise<TaskDigestResult>;
}
