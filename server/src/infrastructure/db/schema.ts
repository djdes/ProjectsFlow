import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  date,
  double,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  tinyint,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import type { NotificationPrefs } from '../../domain/notifications/NotificationPrefs.js';
import type { TelegramNotificationPrefs } from '../../domain/telegram/TelegramNotificationPrefs.js';

// id-длина 36 = UUID v4 в строковой форме (8-4-4-4-12).
const id = () => char('id', { length: 36 }).primaryKey();
const fkUserId = (name: string) => char(name, { length: 36 }).notNull();

const createdAtCol = () =>
  timestamp('created_at').notNull().default(sql`CURRENT_TIMESTAMP`);

const updatedAtCol = () =>
  timestamp('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`).onUpdateNow();

export const users = mysqlTable(
  'users',
  {
    id: id(),
    email: varchar('email', { length: 255 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    displayName: varchar('display_name', { length: 80 }).notNull(),
    avatarUrl: varchar('avatar_url', { length: 500 }),
    // Системный admin/root: глобальный доступ ко всем проектам + раздел управления.
    isAdmin: boolean('is_admin').notNull().default(false),
    // Telegram-привязка через Login Widget. Все опциональны (юзер может не подключать TG).
    // См. db/033 и spec multi-user-telegram-notifications.md.
    telegramUserId: bigint('telegram_user_id', { mode: 'number' }),
    telegramUsername: varchar('telegram_username', { length: 64 }),
    telegramFirstName: varchar('telegram_first_name', { length: 128 }),
    telegramPhotoUrl: varchar('telegram_photo_url', { length: 512 }),
    telegramAuthDate: timestamp('telegram_auth_date'),
    // tg_chat_id для личных чатов === telegram_user_id, но кэшируем явно после /start
    // (TG не позволяет боту писать первым).
    tgChatId: bigint('tg_chat_id', { mode: 'number' }),
    tgStartedAt: timestamp('tg_started_at'),
    tgPairedAt: timestamp('tg_paired_at'),
    tgNotificationPrefs: json('tg_notification_prefs').$type<TelegramNotificationPrefs | null>(),
    defaultNotificationPrefs: json('default_notification_prefs').$type<NotificationPrefs | null>(),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    uniqueIndex('uq_users_email').on(t.email),
    uniqueIndex('uq_users_telegram_user_id').on(t.telegramUserId),
  ],
);

// Аудит исходящих TG-сообщений: дедуп (одинаковые kind+task_id+user в течение минуты —
// skip) и debugging. См. db/033.
export const telegramOutboundMessages = mysqlTable(
  'telegram_outbound_messages',
  {
    id: id(),
    userId: char('user_id', { length: 36 }).notNull(),
    chatId: bigint('chat_id', { mode: 'number' }).notNull(),
    eventKind: varchar('event_kind', { length: 64 }).notNull(),
    taskId: char('task_id', { length: 36 }),
    messageId: bigint('message_id', { mode: 'number' }),
    sentAt: timestamp('sent_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    // 'ok' / 'forbidden' / 'rate_limited' / 'error' / 'skipped_dedup' / 'skipped_pref_off'.
    status: varchar('status', { length: 32 }).notNull(),
    errorText: varchar('error_text', { length: 512 }),
  },
  (t) => [
    index('idx_tg_out_user_sent').on(t.userId, t.sentAt),
    index('idx_tg_out_dedup').on(t.userId, t.eventKind, t.taskId, t.sentAt),
  ],
);

export type TelegramOutboundRow = typeof telegramOutboundMessages.$inferSelect;

// Маппинг отправленных TG-сообщений с ralph-question → question_id, для матчинга reply'ев
// в webhook'е. См. db/036 + spec C:/www/ralph/prompts/telegram-reply-to-ralph-answer.md.
// PK по (chat_id, message_id) — потому что message_id уникален только в рамках чата.
export const telegramRalphQuestionMessages = mysqlTable(
  'telegram_ralph_question_messages',
  {
    tgChatId: bigint('tg_chat_id', { mode: 'number' }).notNull(),
    tgMessageId: bigint('tg_message_id', { mode: 'number' }).notNull(),
    recipientUserId: char('recipient_user_id', { length: 36 }).notNull(),
    taskId: char('task_id', { length: 36 }).notNull(),
    ralphQuestionId: varchar('ralph_question_id', { length: 64 }).notNull(),
    sentAt: timestamp('sent_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    // Композитный PK задаём через index — Drizzle MySQL не имеет prismaPK helper'а,
    // а в БД он создан DDL'ом миграции 036. Тут только для query-планов.
    index('idx_tg_rq_task').on(t.taskId),
    index('idx_tg_rq_user').on(t.recipientUserId),
  ],
);

export type TelegramRalphQuestionRow = typeof telegramRalphQuestionMessages.$inferSelect;

export const sessions = mysqlTable(
  'sessions',
  {
    id: id(),
    userId: fkUserId('user_id'),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: createdAtCol(),
  },
  (t) => [
    index('idx_sessions_user').on(t.userId),
    index('idx_sessions_expires').on(t.expiresAt),
  ],
);

export const projects = mysqlTable(
  'projects',
  {
    id: id(),
    // owner_id остаётся как кеш «кто создал» для backward-compat и отката. Реальный
    // доступ-чек идёт через project_members (см. spec фазу P4 — финальный дроп колонки).
    ownerId: fkUserId('owner_id'),
    name: varchar('name', { length: 80 }).notNull(),
    status: mysqlEnum('status', ['active', 'paused', 'archived']).notNull().default('active'),
    gitRepoUrl: varchar('git_repo_url', { length: 500 }),
    kbRepoFullName: varchar('kb_repo_full_name', { length: 255 }),
    // phantom-flag: «Входящие» — отдельная вкладка для задач без привязки к конкретному проекту.
    // На юзера ровно одна inbox-запись (создаётся лениво через GetOrCreateInbox).
    isInbox: boolean('is_inbox').notNull().default(false),
    // Тип Базы знаний: none / github / local (KB без git-репо).
    kbKind: mysqlEnum('kb_kind', ['none', 'github', 'local']).notNull().default('none'),
    // Видимость финансов: 'owner' (по умолчанию) — только владелец/admin; 'members' — все участники.
    financeVisibility: mysqlEnum('finance_visibility', ['owner', 'members']).notNull().default('owner'),
    // Ralph-диспетчер: какой ЮЗЕР отвечает за автономное выполнение задач этого
    // проекта через MCP /loop. NULL = ручной режим. Должен быть member И иметь
    // активный agent-токен. На revoke последнего токена — auto-NULL во всех
    // dispatched-проектах (см. RevokeAgentToken). См. db/028.
    dispatcherUserId: char('dispatcher_user_id', { length: 36 }),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    index('idx_projects_owner_inbox').on(t.ownerId, t.isInbox),
    uniqueIndex('uq_projects_owner_name').on(t.ownerId, t.name),
    index('idx_projects_owner').on(t.ownerId),
    index('idx_projects_dispatcher_user').on(t.dispatcherUserId),
  ],
);

// Multi-tenancy: участники проекта + их роли. См. spec
// docs/superpowers/specs/2026-05-19-multi-tenant-projects-design.md.
export const projectMembers = mysqlTable(
  'project_members',
  {
    projectId: char('project_id', { length: 36 }).notNull(),
    userId: char('user_id', { length: 36 }).notNull(),
    role: mysqlEnum('role', ['owner', 'editor', 'viewer']).notNull(),
    joinedAt: timestamp('joined_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    // Персональный порядок проекта в сайдбаре этого юзера. См. db/023.
    sortOrder: int('sort_order').notNull().default(0),
    // Пер-участниковые настройки email-оповещений (матрица тип×источник). NULL = дефолты. См. db/024.
    notificationPrefs: json('notification_prefs').$type<NotificationPrefs | null>(),
    // Персональный favorite-флаг + порядок в секции «Избранное» сайдбара. См. db/040.
    // favoriteSortOrder имеет смысл только при isFavorite=true; для не-favorites игнорируется.
    isFavorite: boolean('is_favorite').notNull().default(false),
    favoriteSortOrder: int('favorite_sort_order').notNull().default(0),
  },
  (t) => [
    uniqueIndex('pk_project_members').on(t.projectId, t.userId),
    index('idx_project_members_user').on(t.userId),
  ],
);

export type ProjectMemberRow = typeof projectMembers.$inferSelect;
export type NewProjectMemberRow = typeof projectMembers.$inferInsert;

export const projectInvites = mysqlTable(
  'project_invites',
  {
    id: id(),
    projectId: char('project_id', { length: 36 }).notNull(),
    role: mysqlEnum('role', ['editor', 'viewer']).notNull(),
    token: char('token', { length: 64 }).notNull(),
    email: varchar('email', { length: 255 }),
    expiresAt: timestamp('expires_at').notNull(),
    acceptedAt: timestamp('accepted_at'),
    acceptedByUserId: char('accepted_by_user_id', { length: 36 }),
    createdByUserId: char('created_by_user_id', { length: 36 }).notNull(),
    createdAt: createdAtCol(),
  },
  (t) => [
    uniqueIndex('uq_invites_token').on(t.token),
    index('idx_invites_project').on(t.projectId),
    index('idx_invites_expires').on(t.expiresAt),
  ],
);

export type ProjectInviteRow = typeof projectInvites.$inferSelect;
export type NewProjectInviteRow = typeof projectInvites.$inferInsert;

// Заявки на вступление по совпадению git-репо (см. миграцию 017).
export const projectJoinRequests = mysqlTable(
  'project_join_requests',
  {
    id: id(),
    projectId: char('project_id', { length: 36 }).notNull(),
    requesterUserId: char('requester_user_id', { length: 36 }).notNull(),
    gitRepoUrl: varchar('git_repo_url', { length: 500 }).notNull(),
    status: mysqlEnum('status', ['pending', 'accepted', 'declined']).notNull().default('pending'),
    createdAt: createdAtCol(),
    resolvedAt: timestamp('resolved_at'),
    resolvedByUserId: char('resolved_by_user_id', { length: 36 }),
  },
  (t) => [
    uniqueIndex('uq_join_req_project_requester').on(t.projectId, t.requesterUserId),
    index('idx_join_req_project').on(t.projectId),
    index('idx_join_req_requester').on(t.requesterUserId),
  ],
);

export type ProjectJoinRequestRow = typeof projectJoinRequests.$inferSelect;
export type NewProjectJoinRequestRow = typeof projectJoinRequests.$inferInsert;

// In-app уведомления (см. миграцию 012). type+payload — гибкая полиморфная структура.
export const notifications = mysqlTable(
  'notifications',
  {
    id: id(),
    userId: char('user_id', { length: 36 }).notNull(),
    type: varchar('type', { length: 50 }).notNull(),
    payload: json('payload').notNull(),
    readAt: timestamp('read_at'),
    createdAt: createdAtCol(),
  },
  (t) => [
    index('idx_notifications_user_created').on(t.userId, t.createdAt),
    index('idx_notifications_user_unread').on(t.userId, t.readAt),
  ],
);

export type NotificationRow = typeof notifications.$inferSelect;
export type NewNotificationRow = typeof notifications.$inferInsert;

export const userGithubTokens = mysqlTable('user_github_tokens', {
  // user_id — и FK и PK: у одного юзера ровно один (или ноль) connected GitHub.
  userId: char('user_id', { length: 36 }).primaryKey(),
  accessToken: varchar('access_token', { length: 500 }).notNull(),
  scopes: varchar('scopes', { length: 500 }).notNull().default(''),
  githubLogin: varchar('github_login', { length: 255 }).notNull(),
  githubUserId: varchar('github_user_id', { length: 50 }).notNull(),
  connectedAt: timestamp('connected_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: updatedAtCol(),
});

export const secrets = mysqlTable(
  'secrets',
  {
    id: char('id', { length: 36 }).primaryKey(),
    // Кто записал/обновил секрет (audit). НЕ часть ключа доступа.
    userId: char('user_id', { length: 36 }).notNull(),
    // Scope секрета — проект. Все участники проекта видят один и тот же набор секретов.
    projectId: char('project_id', { length: 36 }),
    secretKey: varchar('secret_key', { length: 500 }).notNull(),
    value: varchar('value', { length: 2000 }).notNull(),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    uniqueIndex('uq_secrets_project_key').on(t.projectId, t.secretKey),
    index('idx_secrets_project').on(t.projectId),
    index('idx_secrets_user').on(t.userId),
  ],
);

export type SecretRow = typeof secrets.$inferSelect;
export type NewSecretRow = typeof secrets.$inferInsert;

export const tasks = mysqlTable(
  'tasks',
  {
    id: id(),
    projectId: char('project_id', { length: 36 }).notNull(),
    description: text('description'),
    status: mysqlEnum('status', [
      'backlog',
      'todo',
      'in_progress',
      'awaiting_clarification',
      'done',
      'manual',
    ])
      .notNull()
      .default('todo'),
    // Float-position для дешёвой вставки между двумя соседями — без массового UPDATE.
    position: double('position').notNull().default(0),
    // Режим работы Ralph по задаче. См. db/035 и domain RalphMode.
    // VARCHAR (не enum) — forward-compat под новые режимы без миграции схемы Drizzle.
    ralphMode: varchar('ralph_mode', { length: 16 }).notNull().default('normal'),
    // Pull-based отмена работы Ralph (см. db/037). NULL = нет запроса; иначе момент
    // когда юзер запросил. Ralph каждые ~5с поллит — увидит флаг, убьёт worker'а, ack-нет.
    ralphCancelRequestedAt: timestamp('ralph_cancel_requested_at'),
    ralphCancelRequestedBy: char('ralph_cancel_requested_by', { length: 36 }),
    // Срок выполнения. DATE без времени (UI: <input type="date">). См. db/041.
    // mode:'string' — Drizzle отдаёт ISO 'YYYY-MM-DD' напрямую (без TZ-shenanigans
    // которые случились бы с Date). Domain хранит string, парсит в Date только UI.
    deadline: date('deadline', { mode: 'string' }),
    // Приоритет 1..4 (1=urgent, 4=low — стиль Todoist). NULL = без приоритета. См. db/041.
    priority: tinyint('priority', { unsigned: true }),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    index('idx_tasks_project_status_position').on(t.projectId, t.status, t.position),
    index('idx_tasks_project').on(t.projectId),
    index('idx_tasks_ralph_cancel').on(t.ralphCancelRequestedAt),
  ],
);

export type TaskRow = typeof tasks.$inferSelect;
export type NewTaskRow = typeof tasks.$inferInsert;

export const taskAttachments = mysqlTable(
  'task_attachments',
  {
    id: id(),
    taskId: char('task_id', { length: 36 }).notNull(),
    // NULL = вложение задачи; заполнен = вложение комментария. См. db/025.
    commentId: char('comment_id', { length: 36 }),
    filename: varchar('filename', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    sizeBytes: int('size_bytes').notNull(),
    storageKey: varchar('storage_key', { length: 500 }).notNull(),
    uploadedAt: timestamp('uploaded_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index('idx_task_attachments_task').on(t.taskId),
    index('idx_task_attachments_comment').on(t.commentId),
  ],
);

export type TaskAttachmentRow = typeof taskAttachments.$inferSelect;
export type NewTaskAttachmentRow = typeof taskAttachments.$inferInsert;

export const taskComments = mysqlTable(
  'task_comments',
  {
    id: id(),
    taskId: char('task_id', { length: 36 }).notNull(),
    ownerUserId: char('owner_user_id', { length: 36 }).notNull(),
    body: text('body').notNull(),
    // 'user' | 'agent' | 'system'. См. db/034 и spec comment-actor-kind.md.
    // DEFAULT 'user' — обратная совместимость для исторических комментов.
    actorKind: varchar('actor_kind', { length: 16 }).notNull().default('user'),
    // Конкретный агент (ralph-dispatcher / ralph-worker / ralph-grillme / ralph-verify).
    // NULL для actor_kind != 'agent'. UI маппит на читаемый title.
    agentName: varchar('agent_name', { length: 64 }),
    // Режим адресации уведомления, выбранный автором в композере: 'all' | 'selected' | 'none'.
    // Питает меню ⋮ «Кто уведомлён» (отличить «Никто» от «всех отфильтровало»). См. db/047.
    notifyMode: varchar('notify_mode', { length: 16 }).notNull().default('all'),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [index('idx_task_comments_task_created').on(t.taskId, t.createdAt)],
);

export type TaskCommentRow = typeof taskComments.$inferSelect;
export type NewTaskCommentRow = typeof taskComments.$inferInsert;

// Журнал доставки уведомлений по комментарию (db/047). Кто каким каналом и с каким
// исходом был уведомлён о конкретном комментарии. Пишется DispatchCommentNotifications,
// читается endpoint'ом GET .../comments/:cid/notifications для меню ⋮ «Кто уведомлён».
export const commentNotifications = mysqlTable(
  'comment_notifications',
  {
    id: id(),
    commentId: char('comment_id', { length: 36 }).notNull(),
    recipientUserId: char('recipient_user_id', { length: 36 }).notNull(),
    // 'email' | 'telegram'.
    channel: varchar('channel', { length: 16 }).notNull(),
    // 'sent' | 'skipped' | 'failed'.
    status: varchar('status', { length: 16 }).notNull(),
    // pref_off | not_linked | no_email | dedup | rate_limited | forbidden | <error>. NULL для 'sent'.
    reason: varchar('reason', { length: 64 }),
    createdAt: createdAtCol(),
  },
  (t) => [
    uniqueIndex('uq_comment_notif').on(t.commentId, t.recipientUserId, t.channel),
    index('idx_comment_notif_comment').on(t.commentId),
  ],
);

export type CommentNotificationRow = typeof commentNotifications.$inferSelect;
export type NewCommentNotificationRow = typeof commentNotifications.$inferInsert;

export const taskCommits = mysqlTable(
  'task_commits',
  {
    taskId: char('task_id', { length: 36 }).notNull(),
    sha: varchar('sha', { length: 64 }).notNull(),
    message: varchar('message', { length: 2000 }).notNull(),
    authorName: varchar('author_name', { length: 200 }).notNull(),
    authorAvatarUrl: varchar('author_avatar_url', { length: 500 }),
    htmlUrl: varchar('html_url', { length: 500 }).notNull(),
    committedAt: timestamp('committed_at').notNull(),
    linkedAt: timestamp('linked_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    // Композитный PK (task_id, sha) объявляется через uniqueIndex — drizzle/mysql-core нет prima compositum API.
    uniqueIndex('pk_task_commits').on(t.taskId, t.sha),
    index('idx_task_commits_sha').on(t.sha),
    index('idx_task_commits_task_committed').on(t.taskId, t.committedAt),
  ],
);

export type TaskCommitRow = typeof taskCommits.$inferSelect;
export type NewTaskCommitRow = typeof taskCommits.$inferInsert;

export const agentTokens = mysqlTable(
  'agent_tokens',
  {
    id: id(),
    userId: char('user_id', { length: 36 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    tokenHash: varchar('token_hash', { length: 255 }).notNull(),
    tokenPrefix: varchar('token_prefix', { length: 20 }).notNull(),
    createdAt: createdAtCol(),
    lastUsedAt: timestamp('last_used_at'),
    revokedAt: timestamp('revoked_at'),
  },
  (t) => [
    index('idx_agent_tokens_user').on(t.userId),
    index('idx_agent_tokens_hash').on(t.tokenHash),
  ],
);

export type AgentTokenRow = typeof agentTokens.$inferSelect;
export type NewAgentTokenRow = typeof agentTokens.$inferInsert;


// --- Финансы проекта (миграции 018-022) ---

export const employees = mysqlTable(
  'employees',
  {
    id: id(),
    ownerUserId: fkUserId('owner_user_id'),
    name: varchar('name', { length: 120 }).notNull(),
    monthlySalaryKopecks: bigint('monthly_salary_kopecks', { mode: 'number' }).notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [index('idx_employees_owner').on(t.ownerUserId)],
);

export const projectEmployeeAssignments = mysqlTable(
  'project_employee_assignments',
  {
    id: id(),
    projectId: char('project_id', { length: 36 }).notNull(),
    employeeId: char('employee_id', { length: 36 }).notNull(),
    allocationPercent: smallint('allocation_percent').notNull().default(100),
    startedAt: date('started_at', { mode: 'date' }).notNull(),
    endedAt: date('ended_at', { mode: 'date' }),
    createdAt: createdAtCol(),
  },
  (t) => [
    uniqueIndex('uq_assignment_project_employee').on(t.projectId, t.employeeId),
    index('idx_assignment_project').on(t.projectId),
    index('idx_assignment_employee').on(t.employeeId),
  ],
);

export const projectExpenses = mysqlTable(
  'project_expenses',
  {
    id: id(),
    projectId: char('project_id', { length: 36 }).notNull(),
    amountKopecks: bigint('amount_kopecks', { mode: 'number' }).notNull(),
    category: varchar('category', { length: 40 }).notNull().default('other'),
    description: varchar('description', { length: 500 }),
    incurredOn: date('incurred_on', { mode: 'date' }).notNull(),
    createdBy: fkUserId('created_by'),
    createdAt: createdAtCol(),
  },
  (t) => [index('idx_expenses_project').on(t.projectId)],
);

export const projectIncomes = mysqlTable(
  'project_incomes',
  {
    id: id(),
    projectId: char('project_id', { length: 36 }).notNull(),
    amountKopecks: bigint('amount_kopecks', { mode: 'number' }).notNull(),
    source: varchar('source', { length: 120 }),
    receivedOn: date('received_on', { mode: 'date' }).notNull(),
    createdBy: fkUserId('created_by'),
    createdAt: createdAtCol(),
  },
  (t) => [index('idx_incomes_project').on(t.projectId)],
);

// Локальная База знаний (kb_kind='local'): markdown-документы проекта в БД.
export const kbDocuments = mysqlTable(
  'kb_documents',
  {
    id: id(),
    projectId: char('project_id', { length: 36 }).notNull(),
    path: varchar('path', { length: 500 }).notNull(),
    content: text('content').notNull(),
    sha: char('sha', { length: 64 }).notNull(),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    uniqueIndex('uq_kb_doc_project_path').on(t.projectId, t.path),
    index('idx_kb_doc_project').on(t.projectId),
  ],
);

export type KbDocumentRow = typeof kbDocuments.$inferSelect;

// Делегирование GitHub-токена members'ами проекта текущему Ralph-диспетчеру.
// **Per-member opt-in** (v0.15+): каждый участник проекта независимо включает
// свою делегацию. PK составной — несколько записей на проект (по одной на члена).
// Реальный токен не копируется — берётся live из user_github_tokens на запросе.
// См. db/030.
export const projectGitTokenDelegations = mysqlTable(
  'project_git_token_delegations',
  {
    projectId: char('project_id', { length: 36 }).notNull(),
    granterUserId: char('granter_user_id', { length: 36 }).notNull(),
    enabled: boolean('enabled').notNull().default(false),
    grantedAt: timestamp('granted_at'),
    revokedAt: timestamp('revoked_at'),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.granterUserId] }),
    index('idx_pgtd_project').on(t.projectId),
    index('idx_pgtd_granter').on(t.granterUserId),
  ],
);

export type ProjectGitTokenDelegationRow = typeof projectGitTokenDelegations.$inferSelect;

// Audit-лог: каждый вызов GET /agent/projects/:id/git-token (успех или нет).
// Owner смотрит «кто и когда брал мой токен» на странице проекта.
export const projectGitTokenAccessLog = mysqlTable(
  'project_git_token_access_log',
  {
    id: id(),
    projectId: char('project_id', { length: 36 }).notNull(),
    accessedByUserId: char('accessed_by_user_id', { length: 36 }).notNull(),
    // null при `not_dispatcher` / `delegation_disabled` / `no_eligible_grantor`
    // (granter может быть неизвестен или их несколько).
    granterUserId: char('granter_user_id', { length: 36 }),
    outcome: mysqlEnum('outcome', [
      'ok',
      'not_dispatcher',
      'delegation_disabled',
      'granter_github_disconnected',
      'granter_not_owner_anymore',
      'no_eligible_grantor',
    ]).notNull(),
    // v0.16: для чего брали токен — 'git_token_fetch' (исходный endpoint),
    // 'link_commit', 'sync_commits', 'kb_write'. NULL для legacy-записей.
    context: varchar('context', { length: 50 }),
    accessedAt: timestamp('accessed_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index('idx_pgtal_project_time').on(t.projectId, t.accessedAt)],
);

export type ProjectGitTokenAccessLogRow = typeof projectGitTokenAccessLog.$inferSelect;

export type EmployeeRow = typeof employees.$inferSelect;
export type ProjectEmployeeAssignmentRow = typeof projectEmployeeAssignments.$inferSelect;
export type ProjectExpenseRow = typeof projectExpenses.$inferSelect;
export type ProjectIncomeRow = typeof projectIncomes.$inferSelect;

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type UserGithubTokenRow = typeof userGithubTokens.$inferSelect;
export type NewUserGithubTokenRow = typeof userGithubTokens.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;

// task_delegations — миграция db/039. One-to-one делегирование inbox-задач.
// Активные = (pending | accepted), терминальные = (declined | withdrawn | archived).
export const taskDelegations = mysqlTable(
  'task_delegations',
  {
    id: id(),
    taskId: char('task_id', { length: 36 }).notNull(),
    delegateUserId: char('delegate_user_id', { length: 36 }).notNull(),
    status: mysqlEnum('status', [
      'pending',
      'accepted',
      'declined',
      'withdrawn',
      'archived',
    ])
      .notNull()
      .default('pending'),
    createdAt: createdAtCol(),
    respondedAt: timestamp('responded_at'),
  },
  (t) => [
    index('idx_task_status').on(t.taskId, t.status),
    index('idx_delegate_status').on(t.delegateUserId, t.status),
  ],
);

export type TaskDelegationRow = typeof taskDelegations.$inferSelect;
export type NewTaskDelegationRow = typeof taskDelegations.$inferInsert;

// ai_prompt_jobs — миграция db/042. Очередь AI-промпт-улучшений: сайт кладёт job,
// Ralph-диспетчер пикапит через MCP и возвращает improved_text. См.
// docs/superpowers/specs/2026-05-28-ai-prompt-improvement-design.md
export const aiPromptJobs = mysqlTable(
  'ai_prompt_jobs',
  {
    id: id(),
    createdBy: fkUserId('created_by'),
    // NULL = inbox / без проекта.
    projectId: char('project_id', { length: 36 }),
    // Денормализованный диспетчер (на момент enqueue).
    dispatcherUserId: char('dispatcher_user_id', { length: 36 }).notNull(),
    status: mysqlEnum('status', ['queued', 'running', 'succeeded', 'failed', 'cancelled'])
      .notNull()
      .default('queued'),
    inputText: text('input_text').notNull(),
    // MEDIUMTEXT в Drizzle отсутствует как отдельный тип, но text() мапит на MariaDB
    // TEXT (до 65535 байт). Пре-собранный KB в MAX_TOTAL=30000 символов уверенно
    // влезает; если в будущем поднимем лимит — миграцией поменяем на MEDIUMTEXT.
    kbContext: text('kb_context'),
    improvedText: text('improved_text'),
    error: varchar('error', { length: 500 }),
    claimedAt: timestamp('claimed_at'),
    finishedAt: timestamp('finished_at'),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    index('idx_ai_prompt_jobs_dispatcher_status').on(
      t.dispatcherUserId,
      t.status,
      t.createdAt,
    ),
    index('idx_ai_prompt_jobs_status_created').on(t.status, t.createdAt),
  ],
);

export type AiPromptJobRow = typeof aiPromptJobs.$inferSelect;
export type NewAiPromptJobRow = typeof aiPromptJobs.$inferInsert;

// ============================================================================
// project_automation — миграция db/045. Автоматизация: если у проекта нет открытых
// задач, диспетчер (ralph) сам генерирует и выполняет задачи по выбранным критериям.
// Сайт хранит конфиг + редактируемые промпты, считает лимит и round-robin критериев.
// См. план virtual-exploring-pascal.md.
// ============================================================================
export const projectAutomation = mysqlTable('project_automation', {
  projectId: char('project_id', { length: 36 }).primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  limitKind: mysqlEnum('limit_kind', ['count', 'time']).notNull().default('count'),
  limitCount: int('limit_count'),
  limitMinutes: int('limit_minutes'),
  pauseMinSeconds: int('pause_min_seconds').notNull().default(60),
  pauseMaxSeconds: int('pause_max_seconds').notNull().default(300),
  ralphMode: varchar('ralph_mode', { length: 16 }).notNull().default('silent'),
  runStatus: mysqlEnum('run_status', ['idle', 'running', 'completed', 'stopped'])
    .notNull()
    .default('idle'),
  runStartedAt: timestamp('run_started_at'),
  tasksCreated: int('tasks_created').notNull().default(0),
  lastTaskAt: timestamp('last_task_at'),
  nextCriterionIdx: int('next_criterion_idx').notNull().default(0),
  createdAt: createdAtCol(),
  updatedAt: updatedAtCol(),
});

export type ProjectAutomationRow = typeof projectAutomation.$inferSelect;
export type NewProjectAutomationRow = typeof projectAutomation.$inferInsert;

// Критерии автоматизации: до 5 строк на проект, редактируемый системный промпт + уточнение.
export const projectAutomationCriteria = mysqlTable(
  'project_automation_criteria',
  {
    projectId: char('project_id', { length: 36 }).notNull(),
    criterionKey: varchar('criterion_key', { length: 40 }).notNull(),
    enabled: boolean('enabled').notNull().default(false),
    systemPrompt: text('system_prompt').notNull(),
    userHint: text('user_hint'),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.criterionKey] })],
);

export type ProjectAutomationCriterionRow = typeof projectAutomationCriteria.$inferSelect;
export type NewProjectAutomationCriterionRow = typeof projectAutomationCriteria.$inferInsert;

// ============================================================================
// file-sync — миграция db/044. Кастомная (не-git) синхронизация папок:
// контент-адресуемые блобы + снепшоты + change-set'ы + round-trip сессии + лента
// прогресса. См. docs/superpowers/specs (PF Desktop Companion).
// ============================================================================

const bytes = (name: string) => bigint(name, { mode: 'number', unsigned: true });
const autoId = () => bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey();

export const syncWorkspaces = mysqlTable(
  'sync_workspaces',
  {
    id: id(),
    projectId: char('project_id', { length: 36 }).notNull(),
    label: varchar('label', { length: 255 }),
    baseSnapshotId: char('base_snapshot_id', { length: 36 }),
    baseVersion: bytes('base_version').notNull().default(0),
    dispatcherHeadSnapshotId: char('dispatcher_head_snapshot_id', { length: 36 }),
    ignoreSetJson: json('ignore_set_json').$type<string[]>().notNull(),
    ignoreSetHash: char('ignore_set_hash', { length: 64 }).notNull(),
    isCaseSensitive: tinyint('is_case_sensitive').notNull().default(0),
    clientProtocolVersion: int('client_protocol_version').notNull().default(1),
    pendingApply: tinyint('pending_apply').notNull().default(0),
    quotaBytes: bytes('quota_bytes').notNull().default(2147483648),
    usedBytes: bytes('used_bytes').notNull().default(0),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [uniqueIndex('uq_sync_ws_project').on(t.projectId)],
);
export type SyncWorkspaceRow = typeof syncWorkspaces.$inferSelect;

export const syncBlobs = mysqlTable(
  'sync_blobs',
  {
    sha256: char('sha256', { length: 64 }).primaryKey(),
    sizeBytes: bytes('size_bytes').notNull(),
    storageKey: varchar('storage_key', { length: 500 }).notNull(),
    refCount: int('ref_count').notNull().default(0),
    pinnedUntil: timestamp('pinned_until'),
    createdAt: createdAtCol(),
  },
  (t) => [index('idx_sync_blobs_ref').on(t.refCount), index('idx_sync_blobs_pin').on(t.pinnedUntil)],
);
export type SyncBlobRow = typeof syncBlobs.$inferSelect;

export const syncSnapshots = mysqlTable(
  'sync_snapshots',
  {
    id: id(),
    workspaceId: char('workspace_id', { length: 36 }).notNull(),
    source: mysqlEnum('source', ['client', 'dispatcher']).notNull(),
    parentSnapshotId: char('parent_snapshot_id', { length: 36 }),
    taskId: char('task_id', { length: 36 }),
    status: mysqlEnum('status', ['draft', 'sealed', 'aborted']).notNull().default('draft'),
    fileCount: int('file_count').notNull().default(0),
    totalBytes: bytes('total_bytes').notNull().default(0),
    manifestSha: char('manifest_sha', { length: 64 }),
    ignoreSetHash: char('ignore_set_hash', { length: 64 }).notNull(),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
    sealedAt: timestamp('sealed_at'),
  },
  (t) => [
    index('idx_sync_snap_ws').on(t.workspaceId),
    index('idx_sync_snap_status').on(t.status),
    index('idx_sync_snap_updated').on(t.updatedAt),
  ],
);
export type SyncSnapshotRow = typeof syncSnapshots.$inferSelect;

export const syncFileEntries = mysqlTable(
  'sync_file_entries',
  {
    id: autoId(),
    snapshotId: char('snapshot_id', { length: 36 }).notNull(),
    path: varchar('path', { length: 1024 }).notNull(),
    pathHash: char('path_hash', { length: 64 }).notNull(),
    blobSha: char('blob_sha', { length: 64 }),
    sizeBytes: bytes('size_bytes').notNull().default(0),
    mode: int('mode').notNull().default(0),
    mtimeMs: bytes('mtime_ms'),
    isSymlink: tinyint('is_symlink').notNull().default(0),
    symlinkTarget: varchar('symlink_target', { length: 1024 }),
  },
  (t) => [
    uniqueIndex('uq_sfe_snap_path').on(t.snapshotId, t.pathHash),
    index('idx_sfe_snap').on(t.snapshotId),
    index('idx_sfe_blob').on(t.blobSha),
  ],
);
export type SyncFileEntryRow = typeof syncFileEntries.$inferSelect;

export const syncChangeSets = mysqlTable(
  'sync_change_sets',
  {
    id: id(),
    baseSnapshotId: char('base_snapshot_id', { length: 36 }).notNull(),
    headSnapshotId: char('head_snapshot_id', { length: 36 }).notNull(),
    changesJson: json('changes_json').notNull(),
    addedCount: int('added_count').notNull().default(0),
    modifiedCount: int('modified_count').notNull().default(0),
    deletedCount: int('deleted_count').notNull().default(0),
    createdAt: createdAtCol(),
  },
  (t) => [uniqueIndex('uq_scs_base_head').on(t.baseSnapshotId, t.headSnapshotId)],
);
export type SyncChangeSetRow = typeof syncChangeSets.$inferSelect;

export const syncSessions = mysqlTable(
  'sync_sessions',
  {
    id: id(),
    workspaceId: char('workspace_id', { length: 36 }).notNull(),
    taskId: char('task_id', { length: 36 }),
    baseSnapshotId: char('base_snapshot_id', { length: 36 }).notNull(),
    resultSnapshotId: char('result_snapshot_id', { length: 36 }),
    status: mysqlEnum('status', [
      'uploaded',
      'materialized',
      'result_ready',
      'applied',
      'conflict',
      'partial',
      'aborted',
    ])
      .notNull()
      .default('uploaded'),
    conflictJson: json('conflict_json'),
    idempotencyKey: varchar('idempotency_key', { length: 128 }),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    index('idx_ss_ws').on(t.workspaceId),
    index('idx_ss_task').on(t.taskId),
    index('idx_ss_status').on(t.status),
    uniqueIndex('uq_ss_idem').on(t.workspaceId, t.idempotencyKey),
  ],
);
export type SyncSessionRow = typeof syncSessions.$inferSelect;

export const taskProgressEvents = mysqlTable(
  'task_progress_events',
  {
    id: autoId(),
    taskId: char('task_id', { length: 36 }).notNull(),
    projectId: char('project_id', { length: 36 }).notNull(),
    seq: int('seq').notNull(),
    kind: varchar('kind', { length: 32 }).notNull(),
    text: text('text'),
    payload: json('payload'),
    createdAt: createdAtCol(),
  },
  (t) => [
    uniqueIndex('uq_tpe_task_seq').on(t.taskId, t.seq),
    index('idx_tpe_task').on(t.taskId),
    index('idx_tpe_created').on(t.createdAt),
  ],
);
export type TaskProgressEventRow = typeof taskProgressEvents.$inferSelect;
