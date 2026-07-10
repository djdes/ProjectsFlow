import type { RalphMode, Task, TaskPriority, TaskStatus } from '@/domain/task/Task';
import type { TaskCommit } from '@/domain/task/TaskCommit';
import type { TaskAttachment } from '@/domain/task/TaskAttachment';
import type { TaskVersionsResult } from '@/domain/task/TaskVersion';
import type {
  CommentNotifications,
  NotifyAudience,
  TaskComment,
} from '@/domain/task/TaskComment';

export type CreateTaskInput = {
  readonly description: string;
  // Иконка задачи: эмодзи / lucide:Name[:color] / data-URL. null/undefined = без иконки. См. db/093.
  readonly icon?: string | null;
  // Обложка задачи: CSS-градиент/пресет или data-URL. null/undefined = без обложки. См. db/094.
  readonly cover?: string | null;
  // Вертикальное положение фокуса обложки (0..100). undefined = дефолт 50. См. db/094.
  readonly coverPosition?: number;
  readonly status?: TaskStatus;
  // Позиция: поставить сразу ПОСЛЕ этой задачи (для цепочки inline-создания). undefined = наверх колонки.
  readonly afterTaskId?: string | null;
  // Режим работы Ralph. Если не передан — backend дефолтит 'normal'.
  readonly ralphMode?: RalphMode;
  // Опциональное one-to-one делегирование. Для inbox-задач делегат — из shared-members
  // caller'а; для задачи реального проекта — участник проекта с ролью editor+ (сервер
  // валидирует). null/undefined — без делегата.
  readonly delegateUserId?: string | null;
  // Срок выполнения 'YYYY-MM-DD'. null = без deadline.
  readonly deadline?: string | null;
  // Приоритет 1..4 (1=urgent, 4=low). null = без приоритета.
  readonly priority?: TaskPriority | null;
};

export type UpdateTaskInput = {
  readonly description?: string;
  // null = очистить иконку; undefined = не менять. См. db/093.
  readonly icon?: string | null;
  // null = очистить обложку; undefined = не менять. См. db/094.
  readonly cover?: string | null;
  // Вертикальное положение фокуса обложки (0..100); undefined = не менять. См. db/094.
  readonly coverPosition?: number;
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
  // История версий задачи (окно версий + Restore, как в Notion).
  getVersions(projectId: string, taskId: string): Promise<TaskVersionsResult>;
  restoreVersion(projectId: string, taskId: string, versionId: string): Promise<Task>;
  listCommits(projectId: string, taskId: string): Promise<TaskCommit[]>;
  linkCommit(projectId: string, taskId: string, sha: string): Promise<TaskCommit>;
  unlinkCommit(projectId: string, taskId: string, sha: string): Promise<void>;
  syncCommits(projectId: string): Promise<SyncCommitsResult>;
  listAttachments(projectId: string, taskId: string): Promise<TaskAttachment[]>;
  // onProgress — опциональный колбэк прогресса аплоада (loaded/total байт) для прогресс-бара.
  uploadAttachment(
    projectId: string,
    taskId: string,
    file: File,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<TaskAttachment>;
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
  // reply — ответ/цитата (db/080): на какой коммент отвечаем + опц. цитируемый фрагмент.
  createComment(
    projectId: string,
    taskId: string,
    body: string,
    notify?: NotifyAudience,
    reply?: { replyToCommentId?: string | null; quotedText?: string | null },
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
  // Делегировать уже созданную задачу (UI «Делегировать» на карточке / AI-распределение).
  // Для inbox delegateUserId — из shared-members caller'а; для реального проекта — участник
  // с ролью editor+. Задача должна быть без активной делегации (иначе AlreadyDelegatedError).
  delegate(projectId: string, taskId: string, delegateUserId: string): Promise<Task>;
  // Переназначить ответственного за уже делегированную задачу (drag на кубик человека
  // во «Входящих»). Прежняя активная делегация архивируется, создаётся новая pending.
  // Область «Максимально»: может делегатор ИЛИ текущий делегат («передать дальше»).
  // Новый делегат не в проекте → сервер вернёт delegate_not_project_member /
  // delegate_not_in_shared_members (клиент открывает флоу приглашения).
  reassign(projectId: string, taskId: string, delegateUserId: string): Promise<Task>;
  // Пригласить человека в проект И делегировать ему задачу (drag на кубик не-участника,
  // после подтверждения). Создаёт делегацию pending_invite; приглашённый принимает
  // (вступает + берёт задачу) или отклоняет (ответственный откатывается).
  inviteDelegate(projectId: string, taskId: string, delegateUserId: string): Promise<Task>;
  // Экспорт выбранных задач в дайджест: вернуть текст (буфер) и/или отправить
  // на email / в Telegram. Сервер рендерит из авторитетных данных.
  digest(projectId: string, input: TaskDigestInput): Promise<TaskDigestResult>;
}
