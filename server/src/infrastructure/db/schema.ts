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
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import type { NotificationPrefs } from '../../domain/notifications/NotificationPrefs.js';

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
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [uniqueIndex('uq_users_email').on(t.email)],
);

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
    ])
      .notNull()
      .default('todo'),
    // Float-position для дешёвой вставки между двумя соседями — без массового UPDATE.
    position: double('position').notNull().default(0),
    delegatedToAgent: boolean('delegated_to_agent').notNull().default(false),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    index('idx_tasks_project_status_position').on(t.projectId, t.status, t.position),
    index('idx_tasks_project').on(t.projectId),
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
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [index('idx_task_comments_task_created').on(t.taskId, t.createdAt)],
);

export type TaskCommentRow = typeof taskComments.$inferSelect;
export type NewTaskCommentRow = typeof taskComments.$inferInsert;

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

export const agentJobs = mysqlTable(
  'agent_jobs',
  {
    id: id(),
    projectId: char('project_id', { length: 36 }).notNull(),
    taskId: char('task_id', { length: 36 }).notNull(),
    status: mysqlEnum('status', ['queued', 'running', 'succeeded', 'failed', 'cancelled'])
      .notNull()
      .default('queued'),
    attempt: int('attempt').notNull().default(1),
    claimedAt: timestamp('claimed_at'),
    startedAt: timestamp('started_at'),
    finishedAt: timestamp('finished_at'),
    error: text('error'),
    prUrl: varchar('pr_url', { length: 500 }),
    branchName: varchar('branch_name', { length: 200 }),
    runnerPid: int('runner_pid'),
    createdBy: fkUserId('created_by'),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    index('idx_agent_jobs_status').on(t.status),
    index('idx_agent_jobs_project_status').on(t.projectId, t.status),
    index('idx_agent_jobs_task').on(t.taskId),
  ],
);

export type AgentJobRow = typeof agentJobs.$inferSelect;
export type NewAgentJobRow = typeof agentJobs.$inferInsert;

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
