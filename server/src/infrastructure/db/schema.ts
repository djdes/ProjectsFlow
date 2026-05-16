import { sql } from 'drizzle-orm';
import {
  char,
  index,
  mysqlEnum,
  mysqlTable,
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

export const magicTokens = mysqlTable(
  'magic_tokens',
  {
    id: id(),
    email: varchar('email', { length: 255 }).notNull(),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    consumedAt: timestamp('consumed_at'),
    createdAt: createdAtCol(),
  },
  (t) => [
    uniqueIndex('uq_magic_tokens_hash').on(t.tokenHash),
    index('idx_magic_tokens_email').on(t.email),
    index('idx_magic_tokens_expires').on(t.expiresAt),
  ],
);

export const projects = mysqlTable(
  'projects',
  {
    id: id(),
    ownerId: fkUserId('owner_id'),
    name: varchar('name', { length: 80 }).notNull(),
    status: mysqlEnum('status', ['active', 'paused', 'archived']).notNull().default('active'),
    gitRepoUrl: varchar('git_repo_url', { length: 500 }),
    kbRepoFullName: varchar('kb_repo_full_name', { length: 255 }),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    uniqueIndex('uq_projects_owner_name').on(t.ownerId, t.name),
    index('idx_projects_owner').on(t.ownerId),
  ],
);

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
    userId: char('user_id', { length: 36 }).notNull(),
    secretKey: varchar('secret_key', { length: 500 }).notNull(),
    encrypted: varchar('encrypted', { length: 2000 }).notNull(),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    uniqueIndex('uq_secrets_user_key').on(t.userId, t.secretKey),
    index('idx_secrets_user').on(t.userId),
  ],
);

export type SecretRow = typeof secrets.$inferSelect;
export type NewSecretRow = typeof secrets.$inferInsert;

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type UserGithubTokenRow = typeof userGithubTokens.$inferSelect;
export type NewUserGithubTokenRow = typeof userGithubTokens.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;
export type MagicTokenRow = typeof magicTokens.$inferSelect;
export type NewMagicTokenRow = typeof magicTokens.$inferInsert;
