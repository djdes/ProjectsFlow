import assert from 'node:assert/strict';
import test from 'node:test';
import { drizzle } from 'drizzle-orm/mysql-proxy';
import { DrizzleNotificationRepository } from './DrizzleNotificationRepository.js';
import type { Database } from '../db/index.js';

test('notification SQL scopes pagination, counters and read mutations before returning data', async () => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const db = drizzle(async (sql, params, method) => {
    queries.push({ sql, params });
    return { rows: method === 'execute' ? [{ affectedRows: 0, insertId: 0 }] : [] };
  });
  const repo = new DrizzleNotificationRepository(db as unknown as Database);
  await repo.listByUser('recipient', { workspaceId: 'space-a', limit: 1, unreadOnly: false });
  await repo.listByUser('recipient', { workspaceId: 'space-a', limit: 1, unreadOnly: true, actionableOnly: true });
  await repo.countUnread('recipient', 'space-a');
  await repo.countActionableUnread('recipient', 'space-a');
  await repo.markRead('notification-from-space-b', 'recipient', new Date(), 'space-a');
  await repo.markAllRead('recipient', new Date(), 'space-a');
  assert.equal(queries.length, 6);
  for (const { sql, params } of queries) {
    const where = sql.slice(sql.indexOf(' where '));
    assert.match(where, /`workspace_id` = \?/);
    assert.match(where, /`user_id` = \?/);
    assert.ok(params.includes('space-a'));
    assert.ok(params.includes('recipient'));
  }
  assert.ok(queries[0]!.sql.indexOf('`workspace_id` = ?') < queries[0]!.sql.indexOf(' limit '));
  assert.match(queries[1]!.sql, /`type` in \(/);
});
