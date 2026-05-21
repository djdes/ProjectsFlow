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
  readonly commentId: string;
  readonly commentExcerpt: string;
  readonly actorUserId: string;
  readonly actorDisplayName: string;
};

// Будущие типы добавятся сюда:
// export type TaskAssignedPayload = { type: 'task_assigned'; ... };
// и т.д. NotificationPayload = CommentMentionPayload | TaskAssignedPayload | ...
export type NotificationPayload = CommentMentionPayload;

export type Notification = {
  readonly id: string;
  readonly userId: string;
  readonly payload: NotificationPayload;
  readonly readAt: Date | null;
  readonly createdAt: Date;
};
