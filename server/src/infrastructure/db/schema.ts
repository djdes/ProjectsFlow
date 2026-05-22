import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  double,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

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
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    index('idx_projects_owner_inbox').on(t.ownerId, t.isInbox),
    uniqueIndex('uq_projects_owner_name').on(t.ownerId, t.name),
    index('idx_projects_owner').on(t.ownerId),
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
    status: mysqlEnum('status', ['backlog', 'todo', 'in_progress', 'done']).notNull().default('todo'),
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
    filename: varchar('filename', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    sizeBytes: int('size_bytes').notNull(),
    storageKey: varchar('storage_key', { length: 500 }).notNull(),
    uploadedAt: timestamp('uploaded_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index('idx_task_attachments_task').on(t.taskId)],
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

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type UserGithubTokenRow = typeof userGithubTokens.$inferSelect;
export type NewUserGithubTokenRow = typeof userGithubTokens.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;
