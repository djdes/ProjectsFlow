import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema.js';
import type { Database } from '../db/index.js';
import { DrizzleAdminRepository } from './DrizzleAdminRepository.js';
import { DrizzleUserRepository } from './DrizzleUserRepository.js';
import { AdminUserError } from '../../domain/user/adminErrors.js';

function harness(options: { admins?: string[]; missing?: boolean; failOn?: string } = {}) {
  const queries: { sql: string; params: unknown[] }[] = [];
  // Run the real SQL builder and row mapper against a recording mysql2 transport.
  const client = {
    query: async (query: { sql: string }, params: unknown[]) => {
      queries.push({ sql: query.sql, params });
      if (options.failOn && query.sql.includes(options.failOn)) throw { code: 'ER_DUP_ENTRY' };
      if (query.sql.startsWith('select')) {
        if (query.sql.includes('`is_admin` = ?')) return [(options.admins ?? ['admin']).map((id) => [id]), []];
        if (query.sql.includes('for update')) return [options.missing ? [] : [['target']], []];
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
  await h.admin.deleteUser('target', 'admin');
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

test('deleted accounts are excluded from authentication, admin lists, bulk lookup and subscriptions', async () => {
  const h = harness();
  assert.equal(await h.users.getById('target'), null);
  assert.equal(await h.users.getByEmail('target@example.test'), null);
  assert.deepEqual(await h.users.getManyByIds(['target']), []);
  await h.users.listAdmins(); await h.admin.listAllUsers(); await h.users.getSubscription('target');
  for (const query of h.queries) assert.match(query.sql, /`deleted_at` is null/);
});

test('stale admin privileges and missing accounts roll back without mutations; self-removal is rejected', async () => {
  for (const action of ['delete', 'demote'] as const) {
    const h = harness({ admins: ['other'] });
    const run = () => action === 'delete' ? h.admin.deleteUser('target', 'admin') : h.admin.updateUser('target', { isAdmin: false }, 'admin');
    await assert.rejects(run, (e: unknown) => e instanceof AdminUserError && e.code === 'admin_access_revoked');
    assert.equal(h.queries.at(-1)!.sql, 'rollback');
    assert.equal(h.queries.some((q) => /^(update|delete)/.test(q.sql)), false);
  }
  const missing = harness({ missing: true });
  await assert.rejects(() => missing.admin.deleteUser('missing', 'admin'), AdminUserError);
  assert.equal(missing.queries.at(-1)!.sql, 'rollback');
  const h = harness();
  await assert.rejects(() => h.admin.deleteUser('admin', 'admin'), AdminUserError);
  await assert.rejects(() => h.admin.updateUser('admin', { isAdmin: false }, 'admin'), AdminUserError);
  assert.equal(h.queries.length, 0);
});

test('deletion failure rolls back and duplicate email becomes a conflict', async () => {
  const failedDelete = harness({ failOn: 'delete from `sessions`' });
  await assert.rejects(() => failedDelete.admin.deleteUser('target', 'admin'));
  assert.equal(failedDelete.queries.at(-1)!.sql, 'rollback');
  assert.ok(!failedDelete.queries.some((q) => q.sql === 'commit'));
  const email = harness({ failOn: 'update `users`' });
  await assert.rejects(() => email.admin.updateUser('target', { email: 'taken@example.test' }, 'admin'),
    (e: unknown) => e instanceof AdminUserError && e.code === 'email_taken');
  assert.equal(email.queries.at(-1)!.sql, 'rollback');
});
