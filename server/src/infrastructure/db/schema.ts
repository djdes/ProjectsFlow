import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  date,
  datetime,
  decimal,
  double,
  index,
  int,
  json,
  mediumtext,
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
import type {
  KanbanBoardSettings,
  KanbanDefaultColors,
} from '../../domain/kanban/KanbanSettings.js';
import type { TelegramNotificationPrefs } from '../../domain/telegram/TelegramNotificationPrefs.js';
import type { ActivityPayload } from '../../domain/activity/ActivityEvent.js';
import type { UiPrefs } from '../../domain/user/UiPrefs.js';
import type {
  TelegramDraftAttachment,
  TelegramDraftOffered,
  TelegramDraftPhoto,
  TelegramDraftSegment,
} from '../../application/telegram/TelegramTaskDraftRepository.js';
import type { VisibleKanbanStatus } from '../../domain/kanban/KanbanSettings.js';
import type {
  SnapshotMetrics,
  LogTails,
  DbHealth,
} from '../../domain/monitoring/ServerSnapshot.js';
import type { PublicAppearance } from '../../domain/project/Project.js';

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
    // Персональная карта дефолтных цветов канбан-колонок — fallback для всех проектов юзера. См. db/057.
    defaultKanbanColors: json('default_kanban_colors').$type<KanbanDefaultColors | null>(),
    // Обобщённый bag клиентских UI-настроек (группировка личных задач и т.д.). См. db/069.
    uiPrefs: json('ui_prefs').$type<UiPrefs | null>(),
    // Активное пространство юзера — единый источник правды для скоупинга проектов. См. db/073.
    currentWorkspaceId: char('current_workspace_id', { length: 36 }),
    // Подписочный план (db/084). free — метеринг без лимитов; prime/vip — лимиты по двум
    // скользящим окнам (5ч / 7д). Истёкший prime/vip лениво трактуется как free на чтении.
    plan: mysqlEnum('plan', ['free', 'prime', 'vip']).notNull().default('free'),
    subscriptionStartedAt: timestamp('subscription_started_at'),
    subscriptionExpiresAt: timestamp('subscription_expires_at'),
    // Разовый пробный Прайм (db/085): метка активации триала (null = не использован).
    primeTrialUsedAt: timestamp('prime_trial_used_at'),
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

// Серверный стейт многошагового конструктора задач в TG-боте (+проект текст @ответственный).
// callback_data ≤ 64 байт → в кнопках только короткий id + индексы, полный контекст здесь.
// См. db/048. TTL ~30 мин (expires_at); getById возвращает null если истёк.
export const telegramTaskDrafts = mysqlTable(
  'telegram_task_drafts',
  {
    id: char('id', { length: 12 }).primaryKey(),
    creatorUserId: char('creator_user_id', { length: 36 }).notNull(),
    tgChatId: bigint('tg_chat_id', { mode: 'number' }).notNull(),
    tgMessageId: bigint('tg_message_id', { mode: 'number' }),
    sourceKey: varchar('source_key', { length: 191 }),
    taskText: text('task_text'),
    projectId: char('project_id', { length: 36 }),
    // Имя физической колонки legacy; в приложении это единственный ответственный задачи.
    assigneeUserId: char('delegate_user_id', { length: 36 }),
    // Legacy-поле старого accept/decline-флоу. Новая логика его не читает и не пишет.
    delegationId: char('delegation_id', { length: 36 }),
    // Предложенные projects/members для резолва index→UUID из callback_data.
    offered: json('offered').$type<TelegramDraftOffered | null>(),
    // AI-распознанные сегменты-задачи (mode='compose'); null = ручной флоу. См. db/067.
    segments: json('segments').$type<TelegramDraftSegment[] | null>(),
    // Входящие Telegram-фото (крупнейший PhotoSize каждого изображения). См. db/116.
    photos: json('photos').$type<TelegramDraftPhoto[] | null>(),
    // Generalized incoming Telegram media and its many-to-many assignment to AI segments.
    // NULL means a legacy row whose media must be lazily read from photos; [] means no files.
    attachments: json('attachments').$type<TelegramDraftAttachment[] | null>(),
    // Колонка канбана для ручного (одиночного) флоу; null = дефолт 'backlog'. См. db/068.
    targetStatus: varchar('target_status', { length: 20 }).$type<VisibleKanbanStatus | null>(),
    status: mysqlEnum('status', ['composing', 'confirming', 'confirmed', 'cancelled', 'expired'])
      .notNull()
      .default('composing'),
    createdAt: createdAtCol(),
    autoCreateAt: timestamp('auto_create_at'),
    confirmationStartedAt: timestamp('confirmation_started_at'),
    expiresAt: timestamp('expires_at').notNull(),
  },
  (t) => [
    index('idx_ttd_creator').on(t.creatorUserId),
    index('idx_ttd_expires').on(t.expiresAt),
    index('idx_ttd_auto_create').on(t.status, t.autoCreateAt),
    uniqueIndex('uq_ttd_source_key').on(t.sourceKey),
  ],
);

export type TelegramTaskDraftRow = typeof telegramTaskDrafts.$inferSelect;

// Маппинг task-сообщений бота → task_id, для reply→комментарий (обобщение
// telegram_ralph_question_messages). См. db/049.
export const telegramTaskMessages = mysqlTable(
  'telegram_task_messages',
  {
    tgChatId: bigint('tg_chat_id', { mode: 'number' }).notNull(),
    tgMessageId: bigint('tg_message_id', { mode: 'number' }).notNull(),
    recipientUserId: char('recipient_user_id', { length: 36 }).notNull(),
    taskId: char('task_id', { length: 36 }).notNull(),
    projectId: char('project_id', { length: 36 }).notNull(),
    sentAt: timestamp('sent_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index('idx_ttm_task').on(t.taskId)],
);

export type TelegramTaskMessageRow = typeof telegramTaskMessages.$inferSelect;

// Привязка группового TG-чата к аккаунту-владельцу (см. db/099). Fallback-задачи от участников
// без своего проекта падают в «Входящие» этого владельца.
export const telegramGroupOwners = mysqlTable(
  'telegram_group_owners',
  {
    tgChatId: bigint('tg_chat_id', { mode: 'number' }).primaryKey(),
    ownerUserId: char('owner_user_id', { length: 36 }).notNull(),
    createdAt: createdAtCol(),
  },
  (t) => [index('idx_tgo_owner').on(t.ownerUserId)],
);

export type TelegramGroupOwnerRow = typeof telegramGroupOwners.$inferSelect;

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
    // Пространство, которому принадлежит проект. Проект живёт ровно в одном пространстве;
    // GET /api/projects скоупится по активному пространству юзера. См. db/073.
    workspaceId: char('workspace_id', { length: 36 }).notNull(),
    // owner_id остаётся как кеш «кто создал» для backward-compat и отката. Реальный
    // доступ-чек идёт через workspace_members (единое пространство, см. spec unified-workspace §3.2).
    ownerId: fkUserId('owner_id'),
    name: varchar('name', { length: 80 }).notNull(),
    // Иконка проекта (Notion-style): эмодзи / lucide:Name[:color] / data-URL. NULL = дефолтная папка.
    // TEXT (было varchar(16)) — вмещает lucide:Name:color и data-URL. См. db/071, db/093.
    icon: text('icon'),
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
    // Мультизадачный воркер: per-project opt-in. TRUE ⇒ Ralph-диспетчер может выполнять
    // до N задач этого проекта ОДНОВРЕМЕННО (для проектов, чьи задачи не конфликтуют в
    // .git). FALSE (default) = «1 проект = 1 задача» (backward-compat). Кап задаёт
    // диспетчер (env PF_PER_PROJECT_MULTITASK_CAP, default 3). См. db/070.
    multiTaskWorker: boolean('multi_task_worker').notNull().default(false),
    // Общая (на весь проект) кастомизация канбан-колонок: цвет / переименованный заголовок /
    // флаг скрытия. Карта status→{color,label,hidden}. NULL = встроенные дефолты. См. db/057.
    kanbanSettings: json('kanban_settings').$type<KanbanBoardSettings | null>(),
    // Notion-style шапка проекта (db/091): описание под названием + обложка.
    // description — свободный текст. coverUrl — `gradient:<id>` (градиент из клиентской
    // палитры) ИЛИ URL картинки (внешняя ссылка / загруженный файл `/api/projects/:id/cover/...`).
    // coverPosition — вертикальное позиционирование фона в % (0–100), для «переместить».
    description: text('description'),
    coverUrl: varchar('cover_url', { length: 500 }),
    coverPosition: int('cover_position').notNull().default(50),
    // Публичная ссылка доски (Publish to web, db/096). publicSlug — случайный неугадываемый
    // slug (URL: /p/<slug>), NULL = не публиковали. isPublic гейтит анонимный доступ.
    // publicIndexing — тоггл индексации поисковиками (default off). publishedAt — момент
    // первой публикации (в domain не читается, только БД-аналитика).
    publicSlug: varchar('public_slug', { length: 64 }),
    isPublic: boolean('is_public').notNull().default(false),
    publicIndexing: boolean('public_indexing').notNull().default(false),
    publicAppearance: json('public_appearance').$type<PublicAppearance | null>(),
    publishedAt: timestamp('published_at'),
    // GitHub-репо приложения проекта (self-serve воркер-раннер, db/097). "owner/repo".
    appRepoFullName: varchar('app_repo_full_name', { length: 255 }),
    // Постоянный слаг сайта-результата (db/100): <site_slug>.projectsflow.ru. До деплоя —
    // заглушка, после — статика (site_artifacts). Заводится при создании проекта. NULL у inbox.
    siteSlug: varchar('site_slug', { length: 64 }),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    index('idx_projects_owner_inbox').on(t.ownerId, t.isInbox),
    // Имя проекта уникально в рамках пространства (не владельца). См. db/073.
    uniqueIndex('uq_projects_workspace_name').on(t.workspaceId, t.name),
    index('idx_projects_owner').on(t.ownerId),
    index('idx_projects_dispatcher_user').on(t.dispatcherUserId),
    index('idx_projects_workspace').on(t.workspaceId),
    // Уникальность + lookup по slug для анонимного публичного роута. См. db/096.
    uniqueIndex('uq_projects_public_slug').on(t.publicSlug),
    // Уникальность + lookup слага сайта для host-роутинга заглушки. См. db/100.
    uniqueIndex('uq_projects_site_slug').on(t.siteSlug),
  ],
);

export const productActionEvents = mysqlTable(
  'product_action_events',
  {
    id: id(),
    userId: fkUserId('user_id'),
    projectId: char('project_id', { length: 36 }),
    action: varchar('action', { length: 40 }).notNull(),
    result: mysqlEnum('result', ['started', 'success', 'failure']).notNull(),
    durationMs: int('duration_ms', { unsigned: true }),
    createdAt: createdAtCol(),
  },
  (t) => [
    index('idx_product_action_created').on(t.createdAt),
    index('idx_product_action_project').on(t.projectId, t.action, t.createdAt),
    index('idx_product_action_user').on(t.userId, t.createdAt),
  ],
);

// Задеплоенный статический результат проекта (self-serve воркер-раннер, db/098). Одна строка
// на проект. slug — отдельный поддомен, независимый от public_slug доски. См. spec 2026-07-06.
export const siteArtifacts = mysqlTable(
  'site_artifacts',
  {
    projectId: char('project_id', { length: 36 }).notNull().primaryKey(),
    slug: varchar('slug', { length: 64 }).notNull(),
    fileCount: int('file_count').notNull().default(0),
    bytes: bigint('bytes', { mode: 'number' }).notNull().default(0),
    publishedAt: timestamp('published_at').notNull().defaultNow(),
    createdAt: createdAtCol(),
  },
  (t) => [uniqueIndex('uq_site_artifacts_slug').on(t.slug)],
);

// Реестр бэкендов пользовательских приложений (self-serve app backend, db/102). Одна строка на
// проект; сами данные приложения — в per-project SQLite-файле. schema_json — объявленная схема.
export const appBackends = mysqlTable('app_backends', {
  projectId: char('project_id', { length: 36 }).notNull().primaryKey(),
  status: mysqlEnum('status', ['none', 'active']).notNull().default('none'),
  schemaJson: mediumtext('schema_json'),
  appKeyHash: varchar('app_key_hash', { length: 255 }),
  usageBytes: bigint('usage_bytes', { mode: 'number' }).notNull().default(0),
  storageLimitBytes: bigint('storage_limit_bytes', { mode: 'number' }).notNull().default(104857600),
  createdAt: createdAtCol(),
  updatedAt: updatedAtCol(),
});

// Пространства (workspaces): верхнеуровневый изолированный контейнер над проектами. См. db/073.
export const workspaces = mysqlTable(
  'workspaces',
  {
    id: id(),
    name: varchar('name', { length: 120 }).notNull(),
    // Эмодзи-иконка пространства (Notion-style); NULL = дефолт (первая буква названия).
    icon: varchar('icon', { length: 16 }),
    // 'default' = личный хаб-со-всеми-моими-проектами (один на владельца, неудаляем, скрыт у чужих);
    // 'team' = созданное вручную командное пространство (свои участники/проекты/чат). См. db/079.
    kind: mysqlEnum('kind', ['default', 'team']).notNull().default('team'),
    ownerUserId: fkUserId('owner_user_id'),
    createdAt: createdAtCol(),
  },
  (t) => [index('idx_workspaces_owner').on(t.ownerUserId)],
);

export type WorkspaceRow = typeof workspaces.$inferSelect;
export type NewWorkspaceRow = typeof workspaces.$inferInsert;

// Участники пространства + роль. Доступ к проекту = участник его пространства + проектная роль.
export const workspaceMembers = mysqlTable(
  'workspace_members',
  {
    workspaceId: char('workspace_id', { length: 36 }).notNull(),
    userId: char('user_id', { length: 36 }).notNull(),
    role: mysqlEnum('role', ['owner', 'editor', 'viewer']).notNull().default('editor'),
    createdAt: createdAtCol(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index('idx_wm_user').on(t.userId),
  ],
);

export type WorkspaceMemberRow = typeof workspaceMembers.$inferSelect;
export type NewWorkspaceMemberRow = typeof workspaceMembers.$inferInsert;

// Invite-ссылки в пространство (db/111) — замена per-project приглашений. Токен одноразовый,
// TTL 7 дней; email — информационное поле, mismatch не блокирует accept.
export const workspaceInvites = mysqlTable(
  'workspace_invites',
  {
    id: id(),
    workspaceId: char('workspace_id', { length: 36 }).notNull(),
    role: mysqlEnum('role', ['editor', 'viewer']).notNull().default('editor'),
    token: char('token', { length: 64 }).notNull(),
    email: varchar('email', { length: 255 }),
    expiresAt: timestamp('expires_at').notNull(),
    acceptedAt: timestamp('accepted_at'),
    acceptedByUserId: char('accepted_by_user_id', { length: 36 }),
    createdByUserId: char('created_by_user_id', { length: 36 }).notNull(),
    createdAt: createdAtCol(),
  },
  (t) => [
    uniqueIndex('uq_ws_invites_token').on(t.token),
    index('idx_ws_invites_workspace').on(t.workspaceId),
    index('idx_ws_invites_expires').on(t.expiresAt),
  ],
);

export type WorkspaceInviteRow = typeof workspaceInvites.$inferSelect;
export type NewWorkspaceInviteRow = typeof workspaceInvites.$inferInsert;

// Общий чат пространства (db/075). Один канал на пространство; seq — глобально-монотонный
// AUTO_INCREMENT курсор (сортировка/пагинация/SSE-replay). Удаление мягкое (deleted_at).
export const workspaceChatMessages = mysqlTable(
  'workspace_chat_messages',
  {
    id: id(),
    seq: bigint('seq', { mode: 'number', unsigned: true }).autoincrement().notNull(),
    workspaceId: char('workspace_id', { length: 36 }).notNull(),
    authorUserId: char('author_user_id', { length: 36 }).notNull(),
    body: text('body').notNull(),
    replyToId: char('reply_to_id', { length: 36 }),
    createdAt: createdAtCol(),
    editedAt: timestamp('edited_at'),
    deletedAt: timestamp('deleted_at'),
  },
  (t) => [
    uniqueIndex('uq_wcm_seq').on(t.seq),
    index('idx_wcm_ws_seq').on(t.workspaceId, t.seq),
  ],
);

export type WorkspaceChatMessageRow = typeof workspaceChatMessages.$inferSelect;
export type NewWorkspaceChatMessageRow = typeof workspaceChatMessages.$inferInsert;

// Реакции: один юзер — одна эмодзи на сообщение максимум один раз.
export const workspaceChatReactions = mysqlTable(
  'workspace_chat_reactions',
  {
    messageId: char('message_id', { length: 36 }).notNull(),
    userId: char('user_id', { length: 36 }).notNull(),
    emoji: varchar('emoji', { length: 16 }).notNull(),
    createdAt: createdAtCol(),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.userId, t.emoji] }),
    index('idx_wcr_message').on(t.messageId),
  ],
);

export type WorkspaceChatReactionRow = typeof workspaceChatReactions.$inferSelect;
export type NewWorkspaceChatReactionRow = typeof workspaceChatReactions.$inferInsert;

// Прочитанное: последний прочитанный seq на (пространство, юзер) → счётчик непрочитанного.
export const workspaceChatReads = mysqlTable(
  'workspace_chat_reads',
  {
    workspaceId: char('workspace_id', { length: 36 }).notNull(),
    userId: char('user_id', { length: 36 }).notNull(),
    lastReadSeq: bigint('last_read_seq', { mode: 'number', unsigned: true }).notNull().default(0),
    updatedAt: updatedAtCol(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

export type WorkspaceChatReadRow = typeof workspaceChatReads.$inferSelect;
export type NewWorkspaceChatReadRow = typeof workspaceChatReads.$inferInsert;

// Вложения сообщений чата. Бинарь — в AttachmentStorage (FS/S3) по storage_key.
export const workspaceChatAttachments = mysqlTable(
  'workspace_chat_attachments',
  {
    id: id(),
    messageId: char('message_id', { length: 36 }).notNull(),
    storageKey: varchar('storage_key', { length: 500 }).notNull(),
    filename: varchar('filename', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    sizeBytes: int('size_bytes').notNull(),
    width: int('width'),
    height: int('height'),
    createdAt: createdAtCol(),
  },
  (t) => [index('idx_wca_message').on(t.messageId)],
);

export type WorkspaceChatAttachmentRow = typeof workspaceChatAttachments.$inferSelect;
export type NewWorkspaceChatAttachmentRow = typeof workspaceChatAttachments.$inferInsert;

// Лента действий: амбиентная активность по проектам для вкладки «Все». Одна строка на
// событие; скоуп при чтении по project_members + workspace_id. Хранение 30 дней (GC). См. db/078.
export const activityEvents = mysqlTable(
  'activity_events',
  {
    id: id(),
    workspaceId: char('workspace_id', { length: 36 }).notNull(),
    projectId: char('project_id', { length: 36 }).notNull(),
    actorUserId: char('actor_user_id', { length: 36 }),
    kind: varchar('kind', { length: 40 }).notNull(),
    payload: json('payload').$type<ActivityPayload | null>(),
    createdAt: createdAtCol(),
  },
  (t) => [
    index('idx_ae_ws_created').on(t.workspaceId, t.createdAt),
    index('idx_ae_project_created').on(t.projectId, t.createdAt),
    index('idx_ae_created').on(t.createdAt),
  ],
);

export type ActivityEventRow = typeof activityEvents.$inferSelect;
export type NewActivityEventRow = typeof activityEvents.$inferInsert;

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
    // Кто создал задачу — серверная атрибуция расхода (db/088).
    createdBy: char('created_by', { length: 36 }),
    // Единственный обязательный ответственный задачи (db/113).
    assigneeUserId: char('assignee_user_id', { length: 36 }).notNull(),
    description: text('description'),
    // Иконка задачи: эмодзи / lucide:Name[:color] / data-URL картинки. TEXT — влезает data-URL. См. db/093.
    icon: text('icon'),
    // Обложка задачи (Notion-style): CSS-градиент/пресет или data-URL картинки. TEXT — влезает data-URL. См. db/094.
    cover: text('cover'),
    // Вертикальное положение фокуса обложки (0..100), как у проекта. DEFAULT 50 = центр. См. db/094.
    coverPosition: int('cover_position').notNull().default(50),
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
    // Статус задачи до перехода в 'done' — для восстановления прежней колонки при снятии
    // галочки «выполнено». VARCHAR(24) (не enum) — forward-compat. NULL = нет снапшота. db/055.
    statusBeforeDone: varchar('status_before_done', { length: 24 }),
    // Float-position для дешёвой вставки между двумя соседями — без массового UPDATE.
    position: double('position').notNull().default(0),
    // Подзадачи (db/107): родительская задача того же проекта. NULL = верхний уровень.
    parentTaskId: char('parent_task_id', { length: 36 }),
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
    // Дата начала работ (db/106): диапазон start_date → deadline (Notion date range).
    startDate: date('start_date', { mode: 'string' }),
    // Приоритет 1..4 (1=urgent, 4=low — стиль Todoist). NULL = без приоритета. См. db/041.
    priority: tinyint('priority', { unsigned: true }),
    // Мягкое удаление (db/134). NULL = живая задача. Заполнено = задача в корзине:
    // скрыта из ВСЕХ выборок, но строка и все её child-таблицы целы, поэтому
    // восстановление возвращает задачу с ТЕМ ЖЕ id.
    deletedAt: datetime('deleted_at'),
    deletedBy: char('deleted_by', { length: 36 }),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    index('idx_tasks_project_status_position').on(t.projectId, t.status, t.position),
    index('idx_tasks_project').on(t.projectId),
    index('idx_tasks_assignee').on(t.assigneeUserId),
    index('idx_tasks_ralph_cancel').on(t.ralphCancelRequestedAt),
    index('idx_tasks_project_deleted').on(t.projectId, t.deletedAt),
    index('idx_tasks_assignee_deleted').on(t.assigneeUserId, t.deletedAt),
  ],
);

export type TaskRow = typeof tasks.$inferSelect;
export type NewTaskRow = typeof tasks.$inferInsert;

// Версии задач (db/092): снимок изменяемых полей на каждое изменение — окно версий + restore.
export const taskVersions = mysqlTable(
  'task_versions',
  {
    id: id(),
    taskId: char('task_id', { length: 36 }).notNull(),
    projectId: char('project_id', { length: 36 }).notNull(),
    actorUserId: char('actor_user_id', { length: 36 }),
    snapshot: json('snapshot').$type<import('../../domain/task/TaskVersion.js').TaskSnapshot>().notNull(),
    changedFields: json('changed_fields')
      .$type<import('../../domain/task/TaskVersion.js').TaskVersionField[]>(),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    index('idx_task_versions_task_time').on(t.taskId, t.createdAt),
    index('idx_task_versions_project').on(t.projectId),
  ],
);
export type TaskVersionRow = typeof taskVersions.$inferSelect;

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
    // Ответ/цитата (db/080). NULL у обычных комментов.
    replyToCommentId: char('reply_to_comment_id', { length: 36 }),
    quotedText: text('quoted_text'),
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
    scopeKind: mysqlEnum('scope_kind', ['account', 'project']).notNull().default('account'),
    projectId: char('project_id', { length: 36 }),
    taskId: char('task_id', { length: 36 }),
    parentTokenId: char('parent_token_id', { length: 36 }),
    expiresAt: timestamp('expires_at'),
    createdAt: createdAtCol(),
    lastUsedAt: timestamp('last_used_at'),
    revokedAt: timestamp('revoked_at'),
  },
  (t) => [
    index('idx_agent_tokens_user').on(t.userId),
    index('idx_agent_tokens_hash').on(t.tokenHash),
    index('idx_agent_tokens_scope').on(t.scopeKind, t.projectId, t.expiresAt),
    index('idx_agent_tokens_parent').on(t.parentTokenId),
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
    // Кто делегировал. NULL только у legacy/осиротевших строк (db/054 бэкфилл +
    // db/056 FK ON DELETE SET NULL). НЕ .notNull() — иначе ломаются чтения legacy-NULL.
    delegatorUserId: char('delegator_user_id', { length: 36 }),
    // Кому вернуть ответственность, если приглашённый отклонит вступление (db/101).
    revertToUserId: char('revert_to_user_id', { length: 36 }),
    status: mysqlEnum('status', [
      'pending',
      'accepted',
      'declined',
      'withdrawn',
      'archived',
      'pending_invite',
    ])
      .notNull()
      .default('pending'),
    createdAt: createdAtCol(),
    respondedAt: timestamp('responded_at'),
  },
  (t) => [
    index('idx_task_status').on(t.taskId, t.status),
    index('idx_delegate_status').on(t.delegateUserId, t.status),
    index('idx_delegator_status').on(t.delegatorUserId, t.status),
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
    // Режим job'а: 'improve' (legacy — одиночное улучшение текста, plain в improved_text)
    // | 'compose' (pass-1: разбивка + «Простой» + классификация, JSON-строка в improved_text)
    // | 'compose-advanced' (pass-2: ленивый «Продвинутый» по сегментам pass-1).
    // См. db/060_ai_prompt_compose.sql + db/065_ai_prompt_compose_advanced.sql.
    mode: mysqlEnum('mode', ['improve', 'compose', 'compose-advanced'])
      .notNull()
      .default('improve'),
    // MEDIUMTEXT (db/066): свободный текст до 50000 символов (≈100КБ в utf8mb4) и JSON
    // сегментов для compose-advanced не влезают в TEXT (64КБ).
    inputText: mediumtext('input_text').notNull(),
    // MEDIUMTEXT (db/060): для compose в kb_context кладутся дайджесты всех проектов-
    // кандидатов (до ~60K символов); legacy improve кладёт KB одного проекта (≤30K).
    kbContext: mediumtext('kb_context'),
    // MEDIUMTEXT (db/060): compose-результат (2 варианта + сегменты) — большая JSON-строка,
    // cap на уровне приложения = 600000 символов. improve кладёт plain-текст ≤600000.
    improvedText: mediumtext('improved_text'),
    error: varchar('error', { length: 500 }),
    // db/083: стоимость прогона «перефразировки» — раннер репортит при complete (как в live_sessions).
    // DECIMAL/BIGINT приходят из mysql2 строкой → Number() в репозитории.
    costUsd: decimal('cost_usd', { precision: 10, scale: 4 }),
    tokensIn: bigint('tokens_in', { mode: 'number' }),
    tokensOut: bigint('tokens_out', { mode: 'number' }),
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

// Durable AI chat history and its dedicated worker queue (db/132). This is kept
// separate from ai_prompt_jobs because those terminal rows are intentionally GC'ed.
export const aiConversations = mysqlTable(
  'ai_conversations',
  {
    id: id(),
    ownerUserId: char('owner_user_id', { length: 36 }).notNull(),
    workspaceId: char('workspace_id', { length: 36 }),
    projectId: char('project_id', { length: 36 }),
    kind: mysqlEnum('kind', ['personal', 'project_studio']).notNull(),
    title: varchar('title', { length: 120 }).notNull(),
    version: int('version', { unsigned: true }).notNull().default(1),
    lastMessageSeq: bigint('last_message_seq', { mode: 'number', unsigned: true }),
    lastMessageAt: timestamp('last_message_at'),
    archivedAt: timestamp('archived_at'),
    deletedAt: timestamp('deleted_at'),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    index('idx_ai_conversations_owner_list').on(t.ownerUserId, t.archivedAt, t.lastMessageAt),
    index('idx_ai_conversations_owner_project').on(
      t.ownerUserId,
      t.projectId,
      t.kind,
      t.archivedAt,
      t.lastMessageAt,
    ),
    index('idx_ai_conversations_project').on(t.projectId, t.deletedAt, t.updatedAt),
  ],
);

export const aiConversationMessages = mysqlTable(
  'ai_conversation_messages',
  {
    id: id(),
    seq: bigint('seq', { mode: 'number', unsigned: true }).autoincrement().notNull(),
    conversationId: char('conversation_id', { length: 36 }).notNull(),
    role: mysqlEnum('role', ['user', 'assistant', 'system', 'tool']).notNull(),
    status: mysqlEnum('status', ['queued', 'running', 'completed', 'failed', 'cancelled'])
      .notNull(),
    body: mediumtext('body').notNull(),
    parentMessageId: char('parent_message_id', { length: 36 }),
    clientRequestId: char('client_request_id', { length: 36 }),
    runId: char('run_id', { length: 36 }),
    model: varchar('model', { length: 120 }),
    metadataJson: json('metadata_json').$type<Record<string, unknown> | null>(),
    errorCode: varchar('error_code', { length: 80 }),
    errorRetryable: boolean('error_retryable').notNull().default(false),
    deletedAt: timestamp('deleted_at'),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    uniqueIndex('uq_ai_conversation_messages_seq').on(t.seq),
    uniqueIndex('uq_ai_conversation_messages_client_request').on(
      t.conversationId,
      t.clientRequestId,
    ),
    index('idx_ai_conversation_messages_conversation_seq').on(t.conversationId, t.seq),
    index('idx_ai_conversation_messages_run').on(t.runId),
  ],
);

export const aiConversationRuns = mysqlTable(
  'ai_conversation_runs',
  {
    id: id(),
    conversationId: char('conversation_id', { length: 36 }).notNull(),
    projectId: char('project_id', { length: 36 }),
    dispatcherUserId: char('dispatcher_user_id', { length: 36 }).notNull(),
    userMessageId: char('user_message_id', { length: 36 }).notNull(),
    assistantMessageId: char('assistant_message_id', { length: 36 }).notNull(),
    mode: mysqlEnum('mode', ['chat', 'studio_plan', 'studio_edit']).notNull(),
    status: mysqlEnum('status', ['queued', 'claimed', 'running', 'completed', 'failed', 'cancelled'])
      .notNull()
      .default('queued'),
    contextVersion: int('context_version', { unsigned: true }).notNull().default(1),
    contextSnapshotJson: json('context_snapshot_json').$type<Record<string, unknown> | null>(),
    idempotencyKey: varchar('idempotency_key', { length: 100 }).notNull(),
    completionIdempotencyKey: varchar('completion_idempotency_key', { length: 100 }),
    leaseTokenHash: char('lease_token_hash', { length: 64 }),
    leaseExpiresAt: timestamp('lease_expires_at'),
    claimedAt: timestamp('claimed_at'),
    projectEditJobId: char('project_edit_job_id', { length: 36 }),
    model: varchar('model', { length: 120 }),
    tokensIn: bigint('tokens_in', { mode: 'number' }),
    tokensOut: bigint('tokens_out', { mode: 'number' }),
    costUsd: decimal('cost_usd', { precision: 12, scale: 6 }),
    errorCode: varchar('error_code', { length: 80 }),
    errorMessage: varchar('error_message', { length: 500 }),
    createdAt: createdAtCol(),
    startedAt: timestamp('started_at'),
    finishedAt: timestamp('finished_at'),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    uniqueIndex('uq_ai_conversation_runs_idempotency').on(t.conversationId, t.idempotencyKey),
    index('idx_ai_conversation_runs_dispatcher').on(t.dispatcherUserId, t.status, t.createdAt),
    index('idx_ai_conversation_runs_project').on(t.projectId, t.status, t.createdAt),
    index('idx_ai_conversation_runs_conversation').on(t.conversationId, t.createdAt),
  ],
);

export const aiConversationAttachments = mysqlTable(
  'ai_conversation_attachments',
  {
    id: id(),
    conversationId: char('conversation_id', { length: 36 }).notNull(),
    messageId: char('message_id', { length: 36 }).notNull(),
    storageKey: varchar('storage_key', { length: 500 }).notNull(),
    originalName: varchar('original_name', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 120 }).notNull(),
    sizeBytes: int('size_bytes', { unsigned: true }).notNull(),
    sha256: char('sha256', { length: 64 }).notNull(),
    deletedAt: timestamp('deleted_at'),
    createdAt: createdAtCol(),
  },
  (t) => [index('idx_ai_conversation_attachments_message').on(t.messageId, t.deletedAt)],
);

export const aiConversationEvents = mysqlTable(
  'ai_conversation_events',
  {
    eventSeq: bigint('event_seq', { mode: 'number', unsigned: true })
      .autoincrement()
      .primaryKey(),
    conversationId: char('conversation_id', { length: 36 }).notNull(),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    entityId: char('entity_id', { length: 36 }),
    payloadJson: json('payload_json').$type<Record<string, unknown> | null>(),
    createdAt: createdAtCol(),
  },
  (t) => [index('idx_ai_conversation_events_conversation').on(t.conversationId, t.eventSeq)],
);

export const aiConversationAuditEvents = mysqlTable(
  'ai_conversation_audit_events',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    conversationId: char('conversation_id', { length: 36 }).notNull(),
    projectId: char('project_id', { length: 36 }),
    runId: char('run_id', { length: 36 }),
    messageId: char('message_id', { length: 36 }),
    actorKind: mysqlEnum('actor_kind', ['user', 'dispatcher', 'system']).notNull(),
    actorUserId: char('actor_user_id', { length: 36 }),
    action: varchar('action', { length: 80 }).notNull(),
    metadataJson: json('metadata_json').$type<Record<string, unknown> | null>(),
    requestId: varchar('request_id', { length: 100 }),
    createdAt: createdAtCol(),
  },
  (t) => [
    index('idx_ai_conversation_audit_conversation').on(t.conversationId, t.createdAt),
    index('idx_ai_conversation_audit_project').on(t.projectId, t.createdAt),
    index('idx_ai_conversation_audit_actor').on(t.actorUserId, t.createdAt),
  ],
);

// Journal of AI action batches (db/135). The UNIQUE (conversation_id, idempotency_key)
// below is what makes re-sending the same plan a no-op instead of a second execution.
export const aiActionBatches = mysqlTable(
  'ai_action_batches',
  {
    id: id(),
    conversationId: char('conversation_id', { length: 36 }).notNull(),
    messageId: char('message_id', { length: 36 }),
    ownerUserId: char('owner_user_id', { length: 36 }).notNull(),
    projectId: char('project_id', { length: 36 }),
    status: mysqlEnum('status', ['pending_review', 'applied', 'rejected', 'undone'])
      .notNull()
      .default('pending_review'),
    title: varchar('title', { length: 200 }).notNull(),
    planJson: json('plan_json').$type<Record<string, unknown> | null>(),
    idempotencyKey: varchar('idempotency_key', { length: 100 }).notNull(),
    createdBy: char('created_by', { length: 36 }).notNull(),
    appliedAt: timestamp('applied_at'),
    undoneAt: timestamp('undone_at'),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    uniqueIndex('uq_ai_action_batches_idempotency').on(t.conversationId, t.idempotencyKey),
    index('idx_ai_action_batches_conversation').on(t.conversationId, t.createdAt),
    index('idx_ai_action_batches_owner').on(t.ownerUserId, t.createdAt),
  ],
);

export const aiActionBatchItems = mysqlTable(
  'ai_action_batch_items',
  {
    id: id(),
    batchId: char('batch_id', { length: 36 }).notNull(),
    position: int('position', { unsigned: true }).notNull(),
    actionId: varchar('action_id', { length: 80 }).notNull(),
    type: varchar('type', { length: 40 }).notNull(),
    entityKind: mysqlEnum('entity_kind', ['project', 'task']).notNull(),
    entityId: char('entity_id', { length: 36 }),
    projectId: char('project_id', { length: 36 }),
    title: varchar('title', { length: 300 }).notNull(),
    status: mysqlEnum('status', ['pending', 'done', 'failed', 'undone'])
      .notNull()
      .default('pending'),
    beforeJson: json('before_json').$type<Record<string, unknown> | null>(),
    errorMessage: varchar('error_message', { length: 500 }),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [index('idx_ai_action_batch_items_batch').on(t.batchId, t.position)],
);

export type AiActionBatchRow = typeof aiActionBatches.$inferSelect;
export type AiActionBatchItemRow = typeof aiActionBatchItems.$inferSelect;

export type AiConversationRow = typeof aiConversations.$inferSelect;
export type AiConversationMessageRow = typeof aiConversationMessages.$inferSelect;
export type AiConversationRunRow = typeof aiConversationRuns.$inferSelect;
export type AiConversationEventRow = typeof aiConversationEvents.$inferSelect;

// ============================================================================
// monitoring_analysis_jobs — миграция db/063. AI-анализ мониторинга через диспетчера.
// Зеркало ai_prompt_jobs: сайт кладёт job с пред-собранным контекстом, Ralph пикапит
// через MCP, анализирует и возвращает markdown-отчёт. project_id/server_id — NOT NULL.
// ============================================================================
export const monitoringAnalysisJobs = mysqlTable(
  'monitoring_analysis_jobs',
  {
    id: id(),
    createdBy: fkUserId('created_by'),
    projectId: char('project_id', { length: 36 }).notNull(),
    serverId: char('server_id', { length: 36 }).notNull(),
    dispatcherUserId: char('dispatcher_user_id', { length: 36 }).notNull(),
    status: mysqlEnum('status', ['queued', 'running', 'succeeded', 'failed', 'cancelled'])
      .notNull()
      .default('queued'),
    analysisType: mysqlEnum('analysis_type', ['snapshot', 'logs', 'alert', 'digest'])
      .notNull()
      .default('snapshot'),
    alertId: char('alert_id', { length: 36 }),
    context: mediumtext('context'),
    note: text('note'),
    resultMarkdown: mediumtext('result_markdown'),
    error: varchar('error', { length: 500 }),
    costUsd: decimal('cost_usd', { precision: 10, scale: 4 }),
    tokensIn: bigint('tokens_in', { mode: 'number' }),
    tokensOut: bigint('tokens_out', { mode: 'number' }),
    claimedAt: timestamp('claimed_at'),
    finishedAt: timestamp('finished_at'),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    index('idx_maj_dispatcher_status').on(t.dispatcherUserId, t.status, t.createdAt),
    index('idx_maj_server_created').on(t.serverId, t.createdAt),
    index('idx_maj_status_created').on(t.status, t.createdAt),
  ],
);

export type MonitoringAnalysisJobRow = typeof monitoringAnalysisJobs.$inferSelect;
export type NewMonitoringAnalysisJobRow = typeof monitoringAnalysisJobs.$inferInsert;

// ============================================================================
// commit_sync_jobs — миграция db/072. Ежедневная авто-обработка статусов задач по
// коммитам: сервер ставит job (задачи + коммиты + порог), ralph матчит коммиты с задачами,
// сервер двигает статусы по порогу при complete. Зеркало monitoring_analysis_jobs.
// ============================================================================
export const commitSyncJobs = mysqlTable(
  'commit_sync_jobs',
  {
    id: id(),
    projectId: char('project_id', { length: 36 }).notNull(),
    // Инициатор (владелец проекта, включивший автоматизацию) — на его тариф метерим/гейтим (db/089).
    createdBy: char('created_by', { length: 36 }),
    dispatcherUserId: char('dispatcher_user_id', { length: 36 }).notNull(),
    status: mysqlEnum('status', ['queued', 'running', 'succeeded', 'failed', 'cancelled'])
      .notNull()
      .default('queued'),
    // Снимок действия из настроек на момент enqueue (db/101): 'propose' — создать предложение
    // закрыть; 'auto' — прежнее авто-перемещение по порогу возраста.
    action: mysqlEnum('action', ['propose', 'auto']).notNull().default('propose'),
    thresholdHours: int('threshold_hours').notNull(),
    context: mediumtext('context'),
    commitsJson: mediumtext('commits_json'),
    matchesJson: mediumtext('matches_json'),
    resultSummary: mediumtext('result_summary'),
    error: varchar('error', { length: 500 }),
    costUsd: decimal('cost_usd', { precision: 10, scale: 4 }),
    tokensIn: bigint('tokens_in', { mode: 'number' }),
    tokensOut: bigint('tokens_out', { mode: 'number' }),
    claimedAt: timestamp('claimed_at'),
    finishedAt: timestamp('finished_at'),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    index('idx_csj_dispatcher_status').on(t.dispatcherUserId, t.status, t.createdAt),
    index('idx_csj_project_created').on(t.projectId, t.createdAt),
    index('idx_csj_status_created').on(t.status, t.createdAt),
  ],
);

export type CommitSyncJobRow = typeof commitSyncJobs.$inferSelect;
export type NewCommitSyncJobRow = typeof commitSyncJobs.$inferInsert;

// ============================================================================
// task_close_proposals — миграция db/101. Предложения закрыть задачу (commit-sync в
// режиме action='propose'). Идемпотентность подтверждения + аудит + in-app карточка.
// UNIQUE(task_id, commit_sha) — анти-дубль при повторных прогонах и при дубле кнопок.
// ============================================================================
export const taskCloseProposals = mysqlTable(
  'task_close_proposals',
  {
    id: id(),
    projectId: char('project_id', { length: 36 }).notNull(),
    taskId: char('task_id', { length: 36 }).notNull(),
    commitSha: varchar('commit_sha', { length: 64 }).notNull(),
    reason: varchar('reason', { length: 1000 }),
    sourceJobId: char('source_job_id', { length: 36 }),
    status: mysqlEnum('status', ['open', 'confirmed', 'dismissed', 'expired'])
      .notNull()
      .default('open'),
    resolvedBy: char('resolved_by', { length: 36 }),
    resolvedAt: timestamp('resolved_at'),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    uniqueIndex('uq_tcp_task_commit').on(t.taskId, t.commitSha),
    index('idx_tcp_project_status').on(t.projectId, t.status, t.createdAt),
    index('idx_tcp_task').on(t.taskId),
  ],
);

export type TaskCloseProposalRow = typeof taskCloseProposals.$inferSelect;
export type NewTaskCloseProposalRow = typeof taskCloseProposals.$inferInsert;

// ============================================================================
// ai_usage_ledger — миграция db/082. Append-only журнал расхода ИИ в USD. user_id =
// dispatcher_user_id прогона (профиль, чей диспетчер выполнял работу) — один юзер = один
// бюджет на все источники. cost_usd авторитетен (репортит раннер). Скользящие окна
// (5ч / 7д) считаются на чтении: SUM(cost_usd) по occurred_at — шедулер не нужен.
// Идемпотентность RecordUsage — UNIQUE(source, ref_id). См. план gleaming-munching-locket.
// ============================================================================
export const aiUsageLedger = mysqlTable(
  'ai_usage_ledger',
  {
    id: id(),
    userId: char('user_id', { length: 36 }).notNull(),
    source: mysqlEnum('source', ['live', 'ai_prompt', 'monitoring', 'commit_sync']).notNull(),
    refId: char('ref_id', { length: 36 }).notNull(),
    projectId: char('project_id', { length: 36 }),
    model: varchar('model', { length: 64 }),
    // DECIMAL/BIGINT возвращаются из mysql2 строкой → Number() в репозитории.
    tokensIn: bigint('tokens_in', { mode: 'number' }),
    tokensOut: bigint('tokens_out', { mode: 'number' }),
    costUsd: decimal('cost_usd', { precision: 10, scale: 4 }).notNull().default('0.0000'),
    occurredAt: timestamp('occurred_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    createdAt: createdAtCol(),
  },
  (t) => [
    uniqueIndex('uq_usage_source_ref').on(t.source, t.refId),
    index('idx_usage_user_occurred').on(t.userId, t.occurredAt),
  ],
);

export type AiUsageLedgerRow = typeof aiUsageLedger.$inferSelect;
export type NewAiUsageLedgerRow = typeof aiUsageLedger.$inferInsert;

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
  // Настройки публикации/деплоя воркера (db/061). От чьего имени коммитить:
  gitAuthorMode: mysqlEnum('git_author_mode', ['bot', 'owner', 'custom']).notNull().default('bot'),
  gitAuthorName: varchar('git_author_name', { length: 120 }),
  gitAuthorEmail: varchar('git_author_email', { length: 254 }),
  // Обходить commit-ритуал CLAUDE.md проекта (без Co-Authored-By, без kanban-синка).
  ignoreClaudeMd: boolean('ignore_claude_md').notNull().default(false),
  // Блокирующая UltraCode-проверка совместимости перед push в прод.
  ultracodeReviewEnabled: boolean('ultracode_review_enabled').notNull().default(false),
  // Как деплоить после успешной задачи: автодеплой GitHub / своя ssh-команда / никак /
  // авто (по инструкции из CLAUDE.md проекта).
  deployMethod: mysqlEnum('deploy_method', ['github_auto', 'ssh_manual', 'none', 'auto'])
    .notNull()
    .default('github_auto'),
  deployCommand: varchar('deploy_command', { length: 500 }),
  runStatus: mysqlEnum('run_status', ['idle', 'running', 'completed', 'stopped'])
    .notNull()
    .default('idle'),
  runStartedAt: timestamp('run_started_at'),
  tasksCreated: int('tasks_created').notNull().default(0),
  lastTaskAt: timestamp('last_task_at'),
  nextCriterionIdx: int('next_criterion_idx').notNull().default(0),
  // Ежедневная авто-обработка статусов задач по коммитам (db/072). Дефолты обновлены в db/101:
  // ВКЛ по умолчанию @ 17:00 (ритуал «предложить закрыть»).
  commitSyncEnabled: boolean('commit_sync_enabled').notNull().default(true),
  commitSyncHour: tinyint('commit_sync_hour').notNull().default(17),
  commitSyncMinute: tinyint('commit_sync_minute').notNull().default(0),
  commitSyncThresholdHours: int('commit_sync_threshold_hours').notNull().default(70),
  commitSyncLastRunOn: date('commit_sync_last_run_on', { mode: 'string' }),
  // EOD/BOD-автоматизации (db/101).
  // Действие commit-sync: предложить закрыть (дефолт) vs авто-перемещение по порогу.
  commitSyncAction: mysqlEnum('commit_sync_action', ['propose', 'auto']).notNull().default('propose'),
  // Фаза 2: напоминание «актуализируй перед уходом» (17:20, ВКЛ по умолчанию).
  eodReminderEnabled: boolean('eod_reminder_enabled').notNull().default(true),
  eodReminderHour: tinyint('eod_reminder_hour').notNull().default(17),
  eodReminderMinute: tinyint('eod_reminder_minute').notNull().default(20),
  eodReminderLastRunOn: date('eod_reminder_last_run_on', { mode: 'string' }),
  // Фаза 3: секция «с чего начать» в дневном дайджесте (ВКЛ по умолчанию).
  dailyPlanEnabled: boolean('daily_plan_enabled').notNull().default(true),
  // Include this project in the workspace-level Telegram digest grouped by assignee.
  assigneeDigestEnabled: boolean('assignee_digest_enabled').notNull().default(false),
  createdAt: createdAtCol(),
  updatedAt: updatedAtCol(),
});

export const appDashboardSettings = mysqlTable('app_dashboard_settings', {
  projectId: char('project_id', { length: 36 }).notNull().primaryKey(),
  settingsJson: mediumtext('settings_json').notNull(),
  createdAt: createdAtCol(),
  updatedAt: updatedAtCol(),
});

export const siteEditorSessions = mysqlTable(
  'site_editor_sessions',
  {
    id: id(),
    projectId: char('project_id', { length: 36 }).notNull(),
    userId: char('user_id', { length: 36 }).notNull(),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    route: varchar('route', { length: 500 }).notNull().default('/'),
    artifactVersion: varchar('artifact_version', { length: 128 }).notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    revokedAt: timestamp('revoked_at'),
    createdAt: createdAtCol(),
  },
  (t) => [
    uniqueIndex('uq_site_editor_sessions_token_hash').on(t.tokenHash),
    index('idx_site_editor_sessions_project').on(t.projectId, t.expiresAt, t.revokedAt),
  ],
);

export const sitePatchSets = mysqlTable(
  'site_patch_sets',
  {
    id: id(),
    projectId: char('project_id', { length: 36 }).notNull(),
    route: varchar('route', { length: 500 }).notNull(),
    revision: int('revision', { unsigned: true }).notNull().default(0),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    uniqueIndex('uq_site_patch_sets_project_route').on(t.projectId, t.route),
    index('idx_site_patch_sets_project').on(t.projectId, t.updatedAt),
  ],
);

export const sitePatches = mysqlTable(
  'site_patches',
  {
    id: id(),
    patchSetId: char('patch_set_id', { length: 36 }).notNull(),
    projectId: char('project_id', { length: 36 }).notNull(),
    locatorJson: mediumtext('locator_json').notNull(),
    kind: mysqlEnum('kind', ['text', 'html', 'style', 'attribute', 'visibility', 'command']).notNull(),
    payloadJson: mediumtext('payload_json').notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 100 }).notNull(),
    createdRevision: int('created_revision', { unsigned: true }).notNull(),
    createdBy: char('created_by', { length: 36 }).notNull(),
    state: mysqlEnum('state', ['draft', 'queued']).notNull().default('draft'),
    publishJobId: char('publish_job_id', { length: 36 }),
    deletedAt: timestamp('deleted_at'),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    uniqueIndex('uq_site_patches_idempotency').on(t.patchSetId, t.idempotencyKey),
    index('idx_site_patches_project_set').on(t.projectId, t.patchSetId, t.deletedAt, t.createdRevision),
    index('idx_site_patches_publish_job').on(t.projectId, t.publishJobId),
  ],
);

export const projectEditJobs = mysqlTable(
  'project_edit_jobs',
  {
    id: id(),
    projectId: char('project_id', { length: 36 }).notNull(),
    createdBy: char('created_by', { length: 36 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 100 }).notNull(),
    dispatcherUserId: char('dispatcher_user_id', { length: 36 }).notNull(),
    status: mysqlEnum('status', ['queued', 'running', 'succeeded', 'failed', 'cancelled'])
      .notNull()
      .default('queued'),
    operation: mysqlEnum('operation', [
      'rewrite_text',
      'restyle',
      'regenerate_element',
      'regenerate_section',
      'replace_icon',
      'edit_code',
    ]).notNull(),
    route: varchar('route', { length: 500 }).notNull(),
    locatorJson: mediumtext('locator_json').notNull(),
    domSnapshot: mediumtext('dom_snapshot').notNull(),
    computedStylesJson: mediumtext('computed_styles_json').notNull(),
    prompt: text('prompt').notNull(),
    artifactVersion: varchar('artifact_version', { length: 128 }).notNull(),
    resultJson: mediumtext('result_json'),
    error: varchar('error', { length: 500 }),
    claimedAt: timestamp('claimed_at'),
    finishedAt: timestamp('finished_at'),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    uniqueIndex('uq_project_edit_jobs_idempotency').on(t.projectId, t.createdBy, t.idempotencyKey),
    index('idx_project_edit_jobs_dispatcher').on(t.dispatcherUserId, t.status, t.createdAt),
    index('idx_project_edit_jobs_project').on(t.projectId, t.status, t.createdAt),
  ],
);

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

// Настройки дайджеста проекта (db/064): Telegram-группа + ежедневная сводка.
export const projectDigestSettings = mysqlTable('project_digest_settings', {
  projectId: char('project_id', { length: 36 }).primaryKey(),
  telegramGroupChatId: bigint('telegram_group_chat_id', { mode: 'number' }),
  telegramGroupTitle: varchar('telegram_group_title', { length: 255 }),
  dailyEnabled: boolean('daily_enabled').notNull().default(false),
  dailyHour: tinyint('daily_hour').notNull().default(9),
  dailyMinute: tinyint('daily_minute').notNull().default(0),
  dailyRecipients: json('daily_recipients').$type<string[] | null>(),
  dailyChannels: json('daily_channels').$type<string[] | null>(),
  dailyTgTargets: json('daily_tg_targets').$type<string[] | null>(),
  dailyTgGrouping: varchar('daily_tg_grouping', { length: 16 }).notNull().default('status'),
  dailyStatuses: json('daily_statuses').$type<string[] | null>(),
  // true — слать сводку только по будням (Пн–Пт МSK). См. db/095.
  dailyWeekdaysOnly: boolean('daily_weekdays_only').notNull().default(false),
  dailyDaysOfWeek: json('daily_days_of_week').$type<number[] | null>(),
  dailyLastSentOn: date('daily_last_sent_on', { mode: 'string' }),
  // Массив {chatId,messageIds[]} последнего ручного теста; авто-сводки не записываются.
  dailyTestDeliveries: json('daily_test_deliveries').$type<
    Array<{ chatId: number; messageIds: number[] }> | null
  >(),
  updatedAt: updatedAtCol(),
});

export type ProjectDigestSettingsRow = typeof projectDigestSettings.$inferSelect;
export type NewProjectDigestSettingsRow = typeof projectDigestSettings.$inferInsert;

// Workspace-level Telegram digest: one message per assignee across opted-in projects.
export const workspaceAssigneeDigestSettings = mysqlTable(
  'workspace_assignee_digest_settings',
  {
    workspaceId: char('workspace_id', { length: 36 }).primaryKey(),
    enabled: boolean('enabled').notNull().default(false),
    sendHour: tinyint('send_hour').notNull().default(9),
    sendMinute: tinyint('send_minute').notNull().default(0),
    weekdaysOnly: boolean('weekdays_only').notNull().default(true),
    daysOfWeek: json('days_of_week').$type<number[] | null>(),
    telegramGroupChatId: bigint('telegram_group_chat_id', { mode: 'number' }),
    telegramGroupTitle: varchar('telegram_group_title', { length: 255 }),
    recipientMode: mysqlEnum('recipient_mode', ['all', 'selected']).notNull().default('all'),
    recipientUserIds: json('recipient_user_ids').$type<string[] | null>(),
    projectMode: mysqlEnum('project_mode', ['all', 'selected']).notNull().default('all'),
    projectIds: json('project_ids').$type<string[] | null>(),
    commitSyncEnabled: boolean('commit_sync_enabled').notNull().default(false),
    commitSyncHour: tinyint('commit_sync_hour').notNull().default(17),
    commitSyncMinute: tinyint('commit_sync_minute').notNull().default(0),
    commitSyncLastSentOn: date('commit_sync_last_sent_on', { mode: 'string' }),
    eodReminderEnabled: boolean('eod_reminder_enabled').notNull().default(false),
    eodReminderHour: tinyint('eod_reminder_hour').notNull().default(17),
    eodReminderMinute: tinyint('eod_reminder_minute').notNull().default(20),
    eodReminderLastSentOn: date('eod_reminder_last_sent_on', { mode: 'string' }),
    lastSentOn: date('last_sent_on', { mode: 'string' }),
    testDeliveries: json('test_deliveries').$type<
      Array<{ chatId: number; messageIds: number[] }> | null
    >(),
    updatedAt: updatedAtCol(),
  },
  (t) => [index('idx_workspace_assignee_digest_enabled').on(t.enabled)],
);

export type WorkspaceAssigneeDigestSettingsRow =
  typeof workspaceAssigneeDigestSettings.$inferSelect;
export type NewWorkspaceAssigneeDigestSettingsRow =
  typeof workspaceAssigneeDigestSettings.$inferInsert;

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

// ============================================================================
// Мониторинг серверов — миграции db/050-052. Серверы проекта (local/remote),
// time-series снимки метрик (pm2/nginx/диск/система) и алерты с state-machine.
// См. spec 2026-06-01-server-monitoring-design.md.
// ============================================================================

export const projectServers = mysqlTable(
  'project_servers',
  {
    id: id(),
    projectId: char('project_id', { length: 36 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    kind: mysqlEnum('kind', ['local', 'remote']).notNull().default('remote'),
    host: varchar('host', { length: 255 }),
    sshPort: int('ssh_port').notNull().default(22),
    sshUser: varchar('ssh_user', { length: 120 }),
    sshCredentialRef: varchar('ssh_credential_ref', { length: 500 }),
    pm2ProcessNames: json('pm2_process_names').$type<string[] | null>(),
    nginxAccessLogPath: varchar('nginx_access_log_path', { length: 500 }),
    nginxErrorLogPath: varchar('nginx_error_log_path', { length: 500 }),
    deployPath: varchar('deploy_path', { length: 500 }),
    healthUrl: varchar('health_url', { length: 500 }),
    enabled: boolean('enabled').notNull().default(true),
    collectIntervalSeconds: int('collect_interval_seconds').notNull().default(300),
    lastSnapshotAt: timestamp('last_snapshot_at'),
    lastStatus: varchar('last_status', { length: 16 }),
    mutedUntil: timestamp('muted_until'),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    uniqueIndex('uq_project_server_name').on(t.projectId, t.name),
    index('idx_project_server_project_kind').on(t.projectId, t.kind),
  ],
);
export type ProjectServerRow = typeof projectServers.$inferSelect;
export type NewProjectServerRow = typeof projectServers.$inferInsert;

export const serverSnapshots = mysqlTable(
  'server_snapshots',
  {
    id: id(),
    serverId: char('server_id', { length: 36 }).notNull(),
    projectId: char('project_id', { length: 36 }).notNull(),
    collectedAt: timestamp('collected_at').notNull(),
    source: mysqlEnum('source', ['local', 'agent']).notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    reachable: boolean('reachable').notNull().default(true),
    metrics: json('metrics').$type<SnapshotMetrics | null>(),
    logs: json('logs').$type<LogTails | null>(),
    dbHealth: json('db_health').$type<DbHealth | null>(),
    errors: json('errors').$type<string[] | null>(),
    cpuLoad1: double('cpu_load1'),
    cpuLoad5: double('cpu_load5'),
    cpuLoad15: double('cpu_load15'),
    memUsedPct: double('mem_used_pct'),
    diskUsedPct: double('disk_used_pct'),
    pm2Online: tinyint('pm2_online'),
    pm2RestartTotal: int('pm2_restart_total'),
    pushedByUserId: char('pushed_by_user_id', { length: 36 }),
    agentTokenId: char('agent_token_id', { length: 36 }),
    createdAt: createdAtCol(),
  },
  (t) => [
    uniqueIndex('uq_snapshot_server_time').on(t.serverId, t.collectedAt),
    index('idx_snapshot_server_time').on(t.serverId, t.collectedAt),
    index('idx_snapshot_project_time').on(t.projectId, t.collectedAt),
    index('idx_snapshot_collected').on(t.collectedAt),
  ],
);
export type ServerSnapshotRow = typeof serverSnapshots.$inferSelect;
export type NewServerSnapshotRow = typeof serverSnapshots.$inferInsert;

export const serverAlertRules = mysqlTable(
  'server_alert_rules',
  {
    projectId: char('project_id', { length: 36 }).notNull(),
    ruleKind: varchar('rule_kind', { length: 32 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    threshold: double('threshold'),
    severity: varchar('severity', { length: 16 }).notNull().default('warning'),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.ruleKind] })],
);
export type ServerAlertRuleRow = typeof serverAlertRules.$inferSelect;

export const serverAlerts = mysqlTable(
  'server_alerts',
  {
    id: id(),
    serverId: char('server_id', { length: 36 }).notNull(),
    projectId: char('project_id', { length: 36 }).notNull(),
    ruleKind: varchar('rule_kind', { length: 32 }).notNull(),
    dedupKey: varchar('dedup_key', { length: 191 }).notNull().default(''),
    activeDedup: varchar('active_dedup', { length: 191 }),
    severity: varchar('severity', { length: 16 }).notNull().default('warning'),
    status: mysqlEnum('status', ['firing', 'resolved']).notNull().default('firing'),
    message: text('message').notNull(),
    details: json('details').$type<Record<string, unknown> | null>(),
    firstSeenAt: timestamp('first_seen_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    lastSeenAt: timestamp('last_seen_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    resolvedAt: timestamp('resolved_at'),
    lastNotifiedAt: timestamp('last_notified_at'),
    createdAt: createdAtCol(),
  },
  (t) => [
    uniqueIndex('uq_alert_active').on(t.serverId, t.ruleKind, t.activeDedup),
    index('idx_alert_project_status').on(t.projectId, t.status),
    index('idx_alert_server').on(t.serverId),
  ],
);
export type ServerAlertRow = typeof serverAlerts.$inferSelect;
export type NewServerAlertRow = typeof serverAlerts.$inferInsert;

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
    // Привязка к live_sessions.id (nullable: file-sync companion-события её не ставят).
    sessionId: char('session_id', { length: 36 }),
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
    index('idx_tpe_session').on(t.sessionId, t.seq),
  ],
);
export type TaskProgressEventRow = typeof taskProgressEvents.$inferSelect;

// ============================================================================
// LIVE-вкладка задачи: стрим действий Ralph-воркера (db/053). Одна таблица метаданных
// сессии; события переиспользуют task_progress_events (session_id). См. план
// effervescent-sleeping-parasol.
// ============================================================================

export const liveSessions = mysqlTable(
  'live_sessions',
  {
    id: id(),
    projectId: char('project_id', { length: 36 }).notNull(),
    taskId: char('task_id', { length: 36 }).notNull(),
    agentName: varchar('agent_name', { length: 64 }),
    attempt: int('attempt').notNull().default(1),
    status: mysqlEnum('status', ['running', 'completed', 'failed', 'timeout', 'canceled'])
      .notNull()
      .default('running'),
    model: varchar('model', { length: 64 }),
    // Плательщик прогона — создатель задачи; legacy fallback хранится для старых строк (db/087).
    billedUserId: char('billed_user_id', { length: 36 }),
    headBefore: char('head_before', { length: 40 }),
    headAfter: char('head_after', { length: 40 }),
    // DECIMAL/BIGINT возвращаются из mysql2 строками → Number() в репозитории.
    costUsd: decimal('cost_usd', { precision: 10, scale: 4 }),
    tokensIn: bigint('tokens_in', { mode: 'number' }),
    tokensOut: bigint('tokens_out', { mode: 'number' }),
    baseSeq: int('base_seq').notNull().default(0),
    lastSeq: int('last_seq').notNull().default(0),
    eventCount: int('event_count').notNull().default(0),
    startedAt: timestamp('started_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    endedAt: timestamp('ended_at'),
    expiresAt: timestamp('expires_at'),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    index('idx_ls_task').on(t.taskId, t.startedAt),
    index('idx_ls_status').on(t.status),
    index('idx_ls_expires').on(t.expiresAt),
  ],
);
export type LiveSessionRow = typeof liveSessions.$inferSelect;
export type NewLiveSessionRow = typeof liveSessions.$inferInsert;

// ============================================================================
// recent_task_views — миграция db/074. Недавно открытые задачи на юзера: источник
// для блока «Недавнее» в сайдбаре (кросс-девайс). Открытие задачи апсертит viewed_at.
// PK (user_id, task_id) — одна строка на задачу. Доступ-фильтр на чтении — через
// project_members (без привязки к workspace). См. план foamy-bubbling-sun.
// ============================================================================
export const recentTaskViews = mysqlTable(
  'recent_task_views',
  {
    userId: char('user_id', { length: 36 }).notNull(),
    taskId: char('task_id', { length: 36 }).notNull(),
    projectId: char('project_id', { length: 36 }).notNull(),
    viewedAt: timestamp('viewed_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.taskId] }),
    index('idx_recent_views_user_viewed').on(t.userId, t.viewedAt),
  ],
);

export type RecentTaskViewRow = typeof recentTaskViews.$inferSelect;
export type NewRecentTaskViewRow = typeof recentTaskViews.$inferInsert;

// ============================================================================
// board_views — миграция db/103. Пользовательские вью доски проекта (Notion-style):
// именованные представления задач. Дефолтная «Доска»
// (канбан) — неявная, здесь только вью, созданные через «+». Общие на проект.
// ============================================================================
export const boardViews = mysqlTable(
  'board_views',
  {
    id: id(),
    projectId: char('project_id', { length: 36 }).notNull(),
    name: varchar('name', { length: 64 }).notNull(),
    type: mysqlEnum('type', [
      'kanban',
      'table',
      'list',
      'calendar',
    ]).notNull(),
    sortOrder: int('sort_order').notNull().default(0),
    // db/105: пер-вью настройки (фильтры/сортировка/колонки/группировка…) —
    // структуру знает клиент, сервер валидирует только размер.
    config: json('config'),
    createdBy: char('created_by', { length: 36 }),
    createdAt: timestamp('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => new Date()),
  },
  (t) => [index('idx_board_views_project').on(t.projectId, t.sortOrder)],
);

export type BoardViewRow = typeof boardViews.$inferSelect;
export type NewBoardViewRow = typeof boardViews.$inferInsert;

// ============================================================================
// task_templates — миграция db/108. Шаблоны задач проекта (Notion Templates):
// заготовка (описание/статус/приоритет/иконка) для меню «Создать ▾».
// ============================================================================
export const taskTemplates = mysqlTable(
  'task_templates',
  {
    id: id(),
    projectId: char('project_id', { length: 36 }).notNull(),
    name: varchar('name', { length: 64 }).notNull(),
    description: mediumtext('description').notNull(),
    status: varchar('status', { length: 24 }).notNull().default('backlog'),
    priority: tinyint('priority', { unsigned: true }),
    icon: text('icon'),
    createdBy: char('created_by', { length: 36 }),
    createdAt: timestamp('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => new Date()),
  },
  (t) => [index('idx_task_templates_project').on(t.projectId)],
);

export type TaskTemplateRow = typeof taskTemplates.$inferSelect;

// ============================================================================
// task_properties / task_property_values — миграция db/109. Кастомные свойства
// задач (Notion custom properties): определения пер-проект + значения пер-задача.
// options/value — строки (JSON/кодировка по типу), парсит репозиторий.
// ============================================================================
export const taskProperties = mysqlTable(
  'task_properties',
  {
    id: id(),
    projectId: char('project_id', { length: 36 }).notNull(),
    name: varchar('name', { length: 64 }).notNull(),
    type: varchar('type', { length: 16 }).notNull(),
    options: text('options'),
    position: int('position').notNull().default(0),
    createdAt: timestamp('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => new Date()),
  },
  (t) => [index('idx_task_properties_project').on(t.projectId)],
);

export type TaskPropertyRow = typeof taskProperties.$inferSelect;

export const taskPropertyValues = mysqlTable(
  'task_property_values',
  {
    taskId: char('task_id', { length: 36 }).notNull(),
    propertyId: char('property_id', { length: 36 }).notNull(),
    value: text('value'),
    updatedAt: timestamp('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.propertyId] }),
    index('idx_task_property_values_property').on(t.propertyId),
  ],
);

export type TaskPropertyValueRow = typeof taskPropertyValues.$inferSelect;

// ============================================================================
// project_views — миграция db/090. Просмотры проекта (аналитика: график Views + Viewers).
// Append-only: каждый заход = строка (клиент троттлит, репозиторий дедупит ~30 мин на
// (user, project)). Доступ к чтению аналитики — участнику проекта (use-case). См. UI-batch S3.
// ============================================================================
export const projectViews = mysqlTable(
  'project_views',
  {
    id: id(),
    userId: char('user_id', { length: 36 }).notNull(),
    projectId: char('project_id', { length: 36 }).notNull(),
    viewedAt: timestamp('viewed_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index('idx_project_views_project_time').on(t.projectId, t.viewedAt),
    index('idx_project_views_user_project_time').on(t.userId, t.projectId, t.viewedAt),
  ],
);

export type ProjectViewRow = typeof projectViews.$inferSelect;
export type NewProjectViewRow = typeof projectViews.$inferInsert;

// ============================================================================
// support_tickets — миграция db/081. Обращения из чат-виджета (вкладка «Поддержка»).
// user_id NULL — анонимная отправка с лендинга. Доставка в Telegram-чат поддержки
// (или fallback на уведомление админам) — best-effort на уровне приложения; тикет
// сохраняется всегда. См. docs/superpowers/specs/2026-06-30-backlog-epic-p2-chat-widget.md.
// ============================================================================
export const supportTickets = mysqlTable(
  'support_tickets',
  {
    id: id(),
    userId: char('user_id', { length: 36 }),
    message: text('message').notNull(),
    source: mysqlEnum('source', ['app', 'landing']).notNull().default('app'),
    status: mysqlEnum('status', ['open', 'closed']).notNull().default('open'),
    createdAt: createdAtCol(),
  },
  (t) => [
    index('idx_support_tickets_status_created').on(t.status, t.createdAt),
    index('idx_support_tickets_user').on(t.userId),
  ],
);

export type SupportTicketRow = typeof supportTickets.$inferSelect;
export type NewSupportTicketRow = typeof supportTickets.$inferInsert;

// ============================================================================
// email_action_tokens — db/086. One-click действия из писем-сводок: «Завершить»/«Комментировать».
// token — случайный opaque, валидируется по БД (как инвайты). user_id = получатель сводки (актор).
// complete — одноразовый (used_at); comment — до истечения. Эндпоинты /api/email-actions/:token.
// ============================================================================
export const emailActionTokens = mysqlTable(
  'email_action_tokens',
  {
    id: id(),
    token: varchar('token', { length: 64 }).notNull(),
    action: mysqlEnum('action', ['complete', 'comment']).notNull(),
    taskId: char('task_id', { length: 36 }).notNull(),
    projectId: char('project_id', { length: 36 }).notNull(),
    userId: char('user_id', { length: 36 }).notNull(),
    usedAt: timestamp('used_at'),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: createdAtCol(),
  },
  (t) => [
    uniqueIndex('uq_email_action_token').on(t.token),
    index('idx_email_action_expires').on(t.expiresAt),
  ],
);

export type EmailActionTokenRow = typeof emailActionTokens.$inferSelect;
export type NewEmailActionTokenRow = typeof emailActionTokens.$inferInsert;

// ============================================================================
// telegram_digest_action_deliveries — db/122. Связывает complete-токен с конкретным
// Telegram-сообщением, чтобы после клика обновить круг и зачеркнуть завершённую задачу.
// ============================================================================
export const telegramDigestActionDeliveries = mysqlTable(
  'telegram_digest_action_deliveries',
  {
    token: varchar('token', { length: 64 }).primaryKey(),
    tgChatId: bigint('tg_chat_id', { mode: 'number' }).notNull(),
    tgMessageId: bigint('tg_message_id', { mode: 'number' }).notNull(),
    messageHtml: mediumtext('message_html').notNull(),
    messageKind: mysqlEnum('message_kind', ['rich', 'html']).notNull().default('rich'),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    index('idx_tg_digest_action_message').on(t.tgChatId, t.tgMessageId),
  ],
);

export type TelegramDigestActionDeliveryRow =
  typeof telegramDigestActionDeliveries.$inferSelect;
export type NewTelegramDigestActionDeliveryRow =
  typeof telegramDigestActionDeliveries.$inferInsert;

// Надёжный журнал административного аудита Data Explorer (db/136). Живёт в MariaDB, а не в
// per-project SQLite `_audit_log`: тот наполняет недоверенный публичный App Runtime и он
// усекается до 2000 событий, из-за чего записи о раскрытии секретов могли вытесняться.
// created_at — ISO-строка с миллисекундами (как в SQLite-журнале), чтобы объединять ленты по времени.
export const appAdminAuditLog = mysqlTable(
  'app_admin_audit_log',
  {
    seq: bigint('seq', { mode: 'number' }).autoincrement().primaryKey(),
    id: char('id', { length: 36 }).notNull(),
    projectId: char('project_id', { length: 36 }).notNull(),
    actorType: varchar('actor_type', { length: 32 }).notNull(),
    actorId: varchar('actor_id', { length: 64 }),
    operation: varchar('operation', { length: 80 }).notNull(),
    tableName: varchar('table_name', { length: 64 }),
    rowId: varchar('row_id', { length: 128 }),
    success: tinyint('success').notNull().default(1),
    detailJson: mediumtext('detail_json'),
    createdAt: varchar('created_at', { length: 32 }).notNull(),
  },
  (t) => [
    uniqueIndex('uq_app_admin_audit_id').on(t.id),
    index('idx_app_admin_audit_project_seq').on(t.projectId, t.seq),
    index('idx_app_admin_audit_project_op').on(t.projectId, t.operation),
    index('idx_app_admin_audit_project_table').on(t.projectId, t.tableName),
    index('idx_app_admin_audit_project_actor').on(t.projectId, t.actorId),
  ],
);

export type AppAdminAuditLogRow = typeof appAdminAuditLog.$inferSelect;
export type NewAppAdminAuditLogRow = typeof appAdminAuditLog.$inferInsert;

// Privacy-preserving traffic of the PUBLISHED application (db/137). Никакого IP и raw UA:
// session_hash — посоленный, ротируемый по дню SHA-256 (счёт уникальных сессий внутри дня, но
// не трекинг между днями); user_agent_class — грубая корзина; path — только pathname без query.
export const appPageVisits = mysqlTable(
  'app_page_visits',
  {
    seq: bigint('seq', { mode: 'number' }).autoincrement().primaryKey(),
    projectId: char('project_id', { length: 36 }).notNull(),
    path: varchar('path', { length: 512 }).notNull(),
    sessionHash: char('session_hash', { length: 64 }).notNull(),
    userAgentClass: varchar('user_agent_class', { length: 16 }).notNull(),
    visitDay: char('visit_day', { length: 10 }).notNull(),
    createdAt: varchar('created_at', { length: 32 }).notNull(),
  },
  (t) => [
    index('idx_app_page_visits_project_day').on(t.projectId, t.visitDay),
  ],
);

export type AppPageVisitRow = typeof appPageVisits.$inferSelect;
export type NewAppPageVisitRow = typeof appPageVisits.$inferInsert;
