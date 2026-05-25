// Дискриминированный union по type. Сейчас один тип — comment_mention, но структура
// позволяет добавить task_assigned / invite_accepted / comment_reply без изменения
// таблицы (всё в JSON-payload).

export type CommentMentionPayload = {
  readonly type: 'comment_mention';
  readonly projectId: string;
  readonly projectName: string;
  readonly taskId: string;
  // Превью описания таски (первые ~80 символов) — чтобы в UI уведомлений показать
  // контекст без отдельного fetch'а task'а.
  readonly taskExcerpt: string;
  // Статус задачи на момент создания нотификации. Клиент подсвечивает выразительнее
  // mention'ы попавшие на awaiting_clarification (это запрос действия от человека).
  // Optional — старые нотификации в БД могут не иметь этого поля.
  readonly taskStatus?: string;
  readonly commentId: string;
  readonly commentExcerpt: string;
  readonly actorUserId: string;
  readonly actorDisplayName: string;
};

// Приглашение в проект. Создаётся при invite на email уже зарегистрированного юзера —
// он видит уведомление с кнопкой «Принять» (token ведёт на /invite/:token).
export type ProjectInvitePayload = {
  readonly type: 'project_invite';
  readonly projectId: string;
  readonly projectName: string;
  readonly role: 'editor' | 'viewer';
  readonly inviteId: string;
  readonly token: string;
  readonly actorUserId: string;
  readonly actorDisplayName: string;
};

// Запрос на вступление по совпадению git-репо. Прилетает владельцу проекта; он решает,
// пускать ли заявителя. Подтверждение добавляет заявителя в project_members.
export type JoinRequestPayload = {
  readonly type: 'join_request';
  readonly projectId: string;
  readonly projectName: string;
  readonly joinRequestId: string;
  readonly requesterUserId: string;
  readonly requesterDisplayName: string;
  readonly actorUserId: string;
  readonly actorDisplayName: string;
};

export type NotificationPayload =
  | CommentMentionPayload
  | ProjectInvitePayload
  | JoinRequestPayload;

export type Notification = {
  readonly id: string;
  readonly userId: string;
  readonly payload: NotificationPayload;
  readonly readAt: Date | null;
  readonly createdAt: Date;
};
