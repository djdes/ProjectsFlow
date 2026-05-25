// Mirrors server/src/domain/notifications/Notification.ts.
// Discriminated union по `type`. Сейчас один тип — comment_mention.

export type CommentMentionPayload = {
  readonly type: 'comment_mention';
  readonly projectId: string;
  readonly projectName: string;
  readonly taskId: string;
  readonly taskExcerpt: string;
  // Статус задачи на момент создания нотификации (server fills in). Используется UI чтобы
  // подсветить ярче mention'ы на awaiting_clarification — это запрос действия от человека.
  // Optional: старые записи в БД могут не иметь этого поля.
  readonly taskStatus?: string;
  readonly commentId: string;
  readonly commentExcerpt: string;
  readonly actorUserId: string;
  readonly actorDisplayName: string;
};

// Приглашение в проект: показывается с кнопкой «Принять» (token → accept).
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

// Запрос на вступление по git-репо: прилетает владельцу проекта.
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
