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
  // Кто оставил коммент: 'user' | 'agent' | 'system'. Используется UI чтобы
  // отрисовать Claude-стиль mention'а от agent'а. Optional — старые payload'ы без.
  readonly actorKind?: 'user' | 'agent' | 'system';
  readonly agentName?: string | null;
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

// Приглашение в пространство: кнопка «Принять» (token → /invites/:token/accept).
export type WorkspaceInvitePayload = {
  readonly type: 'workspace_invite';
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly role: 'editor' | 'viewer';
  readonly inviteId: string;
  readonly token: string;
  readonly actorUserId: string;
  readonly actorDisplayName: string;
};

// Упоминание в чате пространства. Клик ведёт во вкладку «Чат» сайдбара.
export type ChatMentionPayload = {
  readonly type: 'chat_mention';
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly messageId: string;
  readonly messageSeq: number;
  readonly messageExcerpt: string;
  readonly actorUserId: string;
  readonly actorDisplayName: string;
};

// Legacy-контракт для уже сохранённых уведомлений до перехода на task_assignee_changed.
export type TaskDelegationPayload = {
  readonly type: 'task_delegation';
  readonly delegationId: string;
  readonly taskId: string;
  readonly taskExcerpt: string;
  readonly actorUserId: string;
  readonly actorDisplayName: string;
};

// Текущий контракт назначения ответственного. Старые delegation-типы остаются в union,
// чтобы исторические уведомления продолжали отображаться.
export type TaskAssigneeChangedPayload = {
  readonly type: 'task_assignee_changed';
  readonly taskId: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly isInbox: boolean;
  readonly taskExcerpt: string;
  readonly actorUserId: string;
  readonly actorDisplayName: string;
};

// Legacy-контракт старого accept/decline-флоу; нужен только для истории уведомлений.
export type TaskDelegationResolvedPayload = {
  readonly type: 'task_delegation_resolved';
  readonly delegationId: string;
  readonly taskId: string;
  readonly taskExcerpt: string;
  readonly resolution: 'accepted' | 'declined';
  readonly actorUserId: string;
  readonly actorDisplayName: string;
};

// Legacy-контракт старого уведомления о переносе; нужен только для истории.
export type TaskAssignedToProjectPayload = {
  readonly type: 'task_assigned_to_project';
  readonly taskId: string;
  readonly taskExcerpt: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly actorUserId: string;
  readonly actorDisplayName: string;
};

// Алерт мониторинга сервера. Прилетает владельцу; ведёт на вкладку «Мониторинг».
export type ServerAlertPayload = {
  readonly type: 'server_alert';
  readonly projectId: string;
  readonly projectName: string;
  readonly serverId: string;
  readonly serverName: string;
  readonly alertId: string;
  readonly ruleKind: string;
  readonly severity: 'info' | 'warning' | 'critical';
  readonly alertStatus: 'firing' | 'resolved';
  readonly message: string;
};

// Ежедневная сводка по проекту (канал «Уведомления на сайте»). Ведёт на проект.
export type DailyDigestPayload = {
  readonly type: 'daily_digest';
  readonly projectId: string;
  readonly projectName: string;
  readonly taskCount: number;
};

// Новое обращение в поддержку. Прилетает админам/руту; клиент ведёт в /admin (вкладка «Поддержка»).
export type SupportTicketPayload = {
  readonly type: 'support_ticket';
  readonly ticketId: string;
  readonly source: 'app' | 'landing';
  readonly messageExcerpt: string;
  readonly submitterUserId: string | null;
  readonly submitterDisplayName: string | null;
};

export type NotificationPayload =
  | CommentMentionPayload
  | ProjectInvitePayload
  | WorkspaceInvitePayload
  | JoinRequestPayload
  | TaskDelegationPayload
  | TaskAssigneeChangedPayload
  | TaskDelegationResolvedPayload
  | TaskAssignedToProjectPayload
  | ServerAlertPayload
  | DailyDigestPayload
  | SupportTicketPayload
  | ChatMentionPayload;

export type Notification = {
  readonly id: string;
  readonly userId: string;
  readonly payload: NotificationPayload;
  readonly readAt: Date | null;
  readonly createdAt: Date;
  // Задача из payload'а удалена (сервер сверяет на чтении). Уведомление остаётся в списке,
  // но вместо ссылки в 404 UI показывает пометку «задача удалена».
  readonly taskDeleted?: boolean;
};
