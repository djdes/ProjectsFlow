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
  // Кто оставил коммент: 'user' (человек) | 'agent' (Ralph/Claude) | 'system'. Клиент
  // подсвечивает agent-mention'ы Claude-стилем. Optional — старые payload'ы без поля.
  readonly actorKind?: 'user' | 'agent' | 'system';
  // Конкретный agent (ralph-dispatcher | ralph-worker | ralph-grillme | ralph-verify).
  // NULL/undefined для actorKind != 'agent'.
  readonly agentName?: string | null;
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

// Приглашение в пространство (спека unified-workspace §6). Создаётся при invite на email
// зарегистрированного юзера — уведомление с кнопкой «Принять» (token → /invite/:token).
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

// Поручение задачи. Прилетает делегату; информационное — делегирование принимается
// автоматически (спека §4), кнопок Принять/Отклонить нет.
export type TaskDelegationPayload = {
  readonly type: 'task_delegation';
  readonly delegationId: string;
  readonly taskId: string;
  readonly taskExcerpt: string; // первые ~120 символов description
  readonly actorUserId: string; // creator
  readonly actorDisplayName: string;
};

// Ответ делегата на task_delegation. Прилетает создателю.
// resolution: 'accepted' — статус и так виден в UI (только in-app notification);
// resolution: 'declined' — отправляем также email (важная инфо).
// actor = делегат (тот, кто принял/отклонил).
export type TaskDelegationResolvedPayload = {
  readonly type: 'task_delegation_resolved';
  readonly delegationId: string;
  readonly taskId: string;
  readonly taskExcerpt: string;
  readonly resolution: 'accepted' | 'declined';
  readonly actorUserId: string;
  readonly actorDisplayName: string;
};

// Создатель перенёс делегированную задачу в реальный проект — делегат теряет
// доступ (если не member проекта). Прилетает делегату.
export type TaskAssignedToProjectPayload = {
  readonly type: 'task_assigned_to_project';
  readonly taskId: string;
  readonly taskExcerpt: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly actorUserId: string; // creator
  readonly actorDisplayName: string;
};

// Алерт мониторинга сервера. Прилетает участникам проекта при firing/resolved.
// Клиент ведёт на вкладку «Мониторинг» проекта.
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

// Ежедневная сводка по проекту (канал «Уведомления на сайте»). Клиент ведёт на проект.
export type DailyDigestPayload = {
  readonly type: 'daily_digest';
  readonly projectId: string;
  readonly projectName: string;
  readonly taskCount: number;
};

// @mention в общем чате пространства. Прилетает упомянутому участнику; клиент ведёт в чат
// пространства (открывает вид «Чат» и скроллит к сообщению по seq).
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

// Новое обращение в поддержку. Прилетает всем админам (рут видит в разделе «Администрирование»).
// Клиент ведёт в /admin на вкладку «Поддержка».
export type SupportTicketPayload = {
  readonly type: 'support_ticket';
  readonly ticketId: string;
  readonly source: 'app' | 'landing';
  readonly messageExcerpt: string;
  readonly submitterUserId: string | null;
  // null — анонимная отправка с лендинга.
  readonly submitterDisplayName: string | null;
};

// Предложение закрыть задачу (commit-sync в режиме propose, db/101). Прилетает участникам
// проекта; клиент показывает карточку с кнопками «Закрыть»/«Не она» (confirm/dismiss).
// Подтвердить может любой участник (viewer+) — осознанное послабление, как в TG-пути.
export type CloseProposalPayload = {
  readonly type: 'close_proposal';
  readonly proposalId: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly taskId: string;
  readonly taskExcerpt: string;
  readonly commitSha: string;
  readonly reason: string | null;
};

export type NotificationPayload =
  | CommentMentionPayload
  | ProjectInvitePayload
  | WorkspaceInvitePayload
  | JoinRequestPayload
  | TaskDelegationPayload
  | TaskDelegationResolvedPayload
  | TaskAssignedToProjectPayload
  | ServerAlertPayload
  | DailyDigestPayload
  | ChatMentionPayload
  | SupportTicketPayload
  | CloseProposalPayload;

export type Notification = {
  readonly id: string;
  readonly userId: string;
  readonly payload: NotificationPayload;
  readonly readAt: Date | null;
  readonly createdAt: Date;
};
