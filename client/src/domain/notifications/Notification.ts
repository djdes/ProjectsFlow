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

// Делегирование inbox-задачи. Прилетает делегату с кнопками Accept/Decline.
export type TaskDelegationPayload = {
  readonly type: 'task_delegation';
  readonly delegationId: string;
  readonly taskId: string;
  readonly taskExcerpt: string;
  readonly actorUserId: string;
  readonly actorDisplayName: string;
};

// Ответ делегата (accepted/declined). Прилетает создателю.
// actor = делегат.
export type TaskDelegationResolvedPayload = {
  readonly type: 'task_delegation_resolved';
  readonly delegationId: string;
  readonly taskId: string;
  readonly taskExcerpt: string;
  readonly resolution: 'accepted' | 'declined';
  readonly actorUserId: string;
  readonly actorDisplayName: string;
};

// Создатель перенёс делегированную задачу в реальный проект. Прилетает делегату.
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

export type NotificationPayload =
  | CommentMentionPayload
  | ProjectInvitePayload
  | JoinRequestPayload
  | TaskDelegationPayload
  | TaskDelegationResolvedPayload
  | TaskAssignedToProjectPayload
  | ServerAlertPayload;

export type Notification = {
  readonly id: string;
  readonly userId: string;
  readonly payload: NotificationPayload;
  readonly readAt: Date | null;
  readonly createdAt: Date;
};
