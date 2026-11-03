import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema.js';
import type { Database } from '../db/index.js';
import { DrizzleAdminRepository } from './DrizzleAdminRepository.js';
import { DrizzleUserRepository } from './DrizzleUserRepository.js';
import { AdminUserError } from '../../domain/user/adminErrors.js';
import { planUserDeletion, type UserDeletionSnapshot } from '../../domain/user/userDeletion.js';

const plan = (snapshot: UserDeletionSnapshot) => planUserDeletion(snapshot, 'admin');

type Rows = unknown[][];
function harness(options: { admins?: string[]; missing?: boolean; failOn?: string; targetIsAdmin?: boolean;
  workspaces?: Rows; members?: Rows; projects?: Rows; files?: Rows } = {}) {
  const queries: { sql: string; params: unknown[] }[] = [];
  // Run the real SQL builder and row mapper against a recording mysql2 transport.
  const client = {
    query: async (query: { sql: string }, params: unknown[]) => {
      queries.push({ sql: query.sql, params });
      if (options.failOn && query.sql.includes(options.failOn)) throw { code: 'ER_DUP_ENTRY' };
      if (query.sql.startsWith('select')) {
        if (query.sql.includes('`is_admin` = ?')) return [(options.admins ?? ['admin']).map((id) => [id]), []];
        if (query.sql.includes('for update')) return [options.missing ? [] : [['target']], []];
        if (query.sql.startsWith('select `is_admin` from `users`')) return [[[options.targetIsAdmin ?? false]], []];
        if (query.sql.includes('from `workspaces`')) return [options.workspaces ?? [], []];
        if (query.sql.includes('from `workspace_members`')) return [options.members ?? [], []];
        if (query.sql.includes('from `projects`')) return [options.projects ?? [], []];
        if (query.sql.includes('from `task_attachments`')) return [options.files ?? [], []];
        return [[], []];
      }
      return [{ affectedRows: 1, insertId: 0 }, []];
    },
  };
  const db = drizzle(client as never, { schema, mode: 'default' }) as Database;
  return { queries, admin: new DrizzleAdminRepository(db), users: new DrizzleUserRepository(db) };
}

test('deletion anonymizes the account and revokes credentials in one transaction, preserving projects and history', async () => {
  const h = harness();
  await h.admin.deleteUser('target', 'admin', plan);
  const sql = h.queries.map((q) => q.sql);
  assert.equal(sql[0], 'begin'); assert.equal(sql.at(-1), 'commit');
  assert.match(sql[1]!, /order by.*for update$/);
  const userUpdate = h.queries.find((q) => q.sql.startsWith('update `users`'))!;
  assert.match(userUpdate.sql, /`deleted_at` = \?/);
  assert.ok(userUpdate.params.includes('Удалённый пользователь'));
  assert.ok(userUpdate.params.some((v) => typeof v === 'string' && /^deleted-.*@deleted.invalid$/.test(v)));
  assert.ok(userUpdate.params.includes(''));
  for (const table of ['sessions', 'password_reset_tokens', 'user_github_tokens']) {
    assert.ok(sql.some((q) => q.startsWith(`delete from \`${table}\``)), table);
  }
  for (const table of ['agent_tokens', 'project_git_token_delegations', 'projects']) {
    assert.ok(sql.some((q) => q.startsWith(`update \`${table}\``)), table);
  }
  assert.ok(!sql.some((q) => /^delete from `(projects|tasks|users)`/.test(q)));
});

test('deleted accounts are excluded from authentication, admin lists and subscriptions', async () => {
  const h = harness();
  assert.equal(await h.users.getById('target'), null);
  assert.equal(await h.users.getByEmail('target@example.test'), null);
  await h.users.listAdmins(); await h.admin.listAllUsers(); await h.users.getSubscription('target');
  for (const query of h.queries) assert.match(query.sql, /`deleted_at` is null/);
  // Display lookups keep the anonymized row, so history shows «Удалённый пользователь».
  const display = harness();
  await display.users.getManyByIds(['target']);
  assert.doesNotMatch(display.queries[0]!.sql, /`deleted_at` is null/);
});

test('stale admin privileges and missing accounts roll back without mutations; self-removal is rejected', async () => {
  for (const action of ['delete', 'demote'] as const) {
    const h = harness({ admins: ['other'] });
    const run = () => action === 'delete' ? h.admin.deleteUser('target', 'admin', plan) : h.admin.updateUser('target', { isAdmin: false }, 'admin');
    await assert.rejects(run, (e: unknown) => e instanceof AdminUserError && e.code === 'admin_access_revoked');
    assert.equal(h.queries.at(-1)!.sql, 'rollback');
    assert.equal(h.queries.some((q) => /^(update|delete)/.test(q.sql)), false);
  }
  const missing = harness({ missing: true });
  await assert.rejects(() => missing.admin.deleteUser('missing', 'admin', plan), AdminUserError);
  assert.equal(missing.queries.at(-1)!.sql, 'rollback');
  const h = harness();
  await assert.rejects(() => h.admin.deleteUser('admin', 'admin', plan), AdminUserError);
  await assert.rejects(() => h.admin.updateUser('admin', { isAdmin: false }, 'admin'), AdminUserError);
  assert.equal(h.queries.length, 0);
});

test('deletion failure rolls back and duplicate email becomes a conflict', async () => {
  const failedDelete = harness({ failOn: 'delete from `sessions`' });
  await assert.rejects(() => failedDelete.admin.deleteUser('target', 'admin', plan));
  assert.equal(failedDelete.queries.at(-1)!.sql, 'rollback');
  assert.ok(!failedDelete.queries.some((q) => q.sql === 'commit'));
  const email = harness({ failOn: 'update `users`' });
  await assert.rejects(() => email.admin.updateUser('target', { email: 'taken@example.test' }, 'admin'),
    (e: unknown) => e instanceof AdminUserError && e.code === 'email_taken');
  assert.equal(email.queries.at(-1)!.sql, 'rollback');
});

test('deletion removes personal workspaces and inboxes, hands team data to the owner and cleans per-user state', async () => {
  const h = harness({
    workspaces: [
      ['ws-personal', 'Личное', 'default', 'target', 'owner'],
      ['ws-team', 'Команда', 'team', 'boss', 'editor'],
      ['ws-shared', 'Совладение', 'team', 'target', 'owner'],
    ],
    members: [['ws-team', 'boss', 'owner', 'Босс'], ['ws-shared', 'co', 'owner', 'Совладелец']],
    projects: [
      ['p-own', 'Мой', 'ws-personal', 0, 'target', 3, 2],
      ['p-inbox', 'Входящие', 'ws-team', 1, 'target', 1, 1],
      ['p-team', 'Сайт', 'ws-team', 0, 'target', 5, 2],
      ['p-other', 'Чужой', 'ws-team', 0, 'boss', 4, 0],
    ],
    files: [['files/a.png']],
  });
  const result = await h.admin.deleteUser('target', 'admin', plan);
  assert.deepEqual(result.storageKeys, ['files/a.png']);
  assert.deepEqual(result.plan.removeProjectIds, ['p-own', 'p-inbox']);
  assert.deepEqual(result.plan.summary.leftWorkspaces.map((w) => w.name), ['Команда', 'Совладение']);
  const find = (prefix: string) => h.queries.filter((q) => q.sql.startsWith(prefix));
  assert.deepEqual(find('delete from `projects`').map((q) => q.params.at(-1)), ['p-own', 'p-inbox']);
  assert.deepEqual(find('delete from `workspaces`').map((q) => q.params), [['ws-personal']]);
  const reassigned = find('update `tasks`');
  assert.equal(reassigned.length, 1);
  assert.deepEqual(reassigned[0]!.params, ['boss', 'p-team', 'target']);
  assert.ok(find('update `projects` set `owner_id`').some((q) => q.params[0] === 'boss' && q.params[1] === 'p-team'));
  assert.deepEqual(find('update `workspaces`').map((q) => q.params), [['co', 'ws-shared']]);
  for (const table of ['workspace_members', 'project_members', 'notifications', 'comment_notifications', 'telegram_chat_workspaces',
    'telegram_group_owners', 'llm_connections', 'llm_device_logins']) {
    assert.ok(find(`delete from \`${table}\``).length > 0, table);
  }
  assert.ok(h.queries.some((q) => q.sql.includes('UPDATE mailing_recipients') && q.params[0] === 'target'));
  // Personal data is removed before the account row is anonymized, all in one transaction.
  assert.equal(h.queries.at(-1)!.sql, 'commit');
});

test('a sole-owned team workspace with members blocks deletion before any mutation', async () => {
  const h = harness({
    workspaces: [['ws-team', 'Команда', 'team', 'target', 'owner']],
    members: [['ws-team', 'emp', 'editor', 'Сотрудник']],
  });
  await assert.rejects(() => h.admin.deleteUser('target', 'admin', (s) => {
    const decided = plan(s);
    if (decided.blockers.length) throw new AdminUserError('deletion_blocked', 'blocked');
    return decided;
  }), (e: unknown) => e instanceof AdminUserError && e.code === 'deletion_blocked');
  assert.equal(h.queries.at(-1)!.sql, 'rollback');
  assert.equal(h.queries.some((q) => /^(update|delete)/i.test(q.sql)), false);
});
