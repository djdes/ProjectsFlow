import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import type { Pool } from 'mysql2/promise';
import { MysqlMailingRepository } from './MysqlMailingRepository.js';
import { MailingError } from '../../domain/mailing/Mailing.js';
import { INPUT, NOW, exampleJob } from '../../../test/mailingHarness.js';

const row = (patch: Record<string, unknown> = {}) => ({ id: 'campaign', title: INPUT.title, content_json: JSON.stringify(INPUT.content),
  channels_json: JSON.stringify(INPUT.channels), audience_json: JSON.stringify(INPUT.audience), status: 'draft', revision: 2,
  created_at: NOW, updated_at: NOW, created_by_name: 'Admin', created_by_id: null, scheduled_at: null, ...patch });
function fixture(answer: (sql: string, params: unknown[]) => unknown) {
  const calls: { sql: string; params: unknown[] }[] = []; const events: string[] = [];
  const connection = { query: async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return [answer(sql, params), []]; },
    beginTransaction: async () => { events.push('begin'); }, commit: async () => { events.push('commit'); },
    rollback: async () => { events.push('rollback'); }, release: () => { events.push('release'); } };
  return { calls, events, repository: new MysqlMailingRepository({ ...connection, getConnection: async () => connection } as unknown as Pool) };
}

test('enqueue locks revision and atomically snapshots per-channel recipients with independent opaque tokens', async () => {
  const f = fixture(sql => sql.startsWith('SELECT') ? [row()] : { affectedRows: 1 });
  const job = exampleJob();
  await f.repository.enqueue('campaign', 2, [{ key: job.email!, userId: job.userId, contactId: null, email: job.email, name: job.name, company: job.company, channels: ['email', 'site'] }], null, NOW);
  assert.match(f.calls[0]!.sql, /FOR UPDATE/);
  const insert = f.calls.find(c => c.sql.startsWith('INSERT INTO mailing_deliveries'))!;
  assert.equal(insert.params.length, 22); assert.equal(insert.params[3], 'user');
  assert.match(insert.params[10] as string, /^[a-f0-9]{64}$/); assert.notEqual(insert.params[10], insert.params[21]);
  assert.equal(insert.sql.includes(job.email!), false); assert.deepEqual(f.events, ['begin', 'commit', 'release']);
});

test('an identical accepted launch is idempotent; stale or different revisions roll back without new deliveries', async () => {
  const f = fixture(sql => sql.startsWith('SELECT') ? [row({ status: 'sending', revision: 3, launch_revision: 2 })] : { affectedRows: 1 });
  await f.repository.enqueue('campaign', 2, [], null, NOW);
  assert.equal(f.calls.some(c => c.sql.startsWith('INSERT')), false);
  await assert.rejects(() => f.repository.enqueue('campaign', 3, [], null, NOW), (e: unknown) => e instanceof MailingError && e.status === 409);
  assert.deepEqual(f.events.slice(-3), ['begin', 'rollback', 'release']);
  const stale = fixture(() => [row()]);
  await assert.rejects(() => stale.repository.enqueue('campaign', 1, [], null, NOW), MailingError);
  assert.equal(stale.calls.length, 1);
});

test('failed snapshot insert rolls back the transaction and never marks the campaign as sending', async () => {
  const f = fixture(sql => { if (sql.startsWith('INSERT')) throw new Error('database failure'); return [row()]; });
  await assert.rejects(() => f.repository.enqueue('campaign', 2, [{ key: 'x@example.com', userId: 'u1', contactId: null, email: 'x@example.com', name: '', company: '', channels: ['email'] }], null, NOW));
  assert.deepEqual(f.events, ['begin', 'rollback', 'release']); assert.equal(f.calls.some(c => c.sql.startsWith('UPDATE')), false);
});

test('global paused or exhausted rate budget cannot claim a job; reservations count attempt history', async () => {
  for (const budget of [{ enabled: 0, minute: 0, day: 0 }, { enabled: 1, minute: 30, day: 40 }, { enabled: 1, minute: 0, day: 1000 }]) {
    const f = fixture(sql => sql.includes('FROM mailing_settings') ? [{ enabled: budget.enabled, per_minute: 30, per_day: 1000 }] : [{ minute_count: budget.minute, day_count: budget.day }]);
    assert.equal(await f.repository.claim(NOW), null);
    assert.match(f.calls[0]!.sql, /FOR UPDATE/); assert.equal(f.calls.some(c => c.sql.includes('JOIN mailing_campaigns')), false);
    if (budget.enabled) assert.match(f.calls[1]!.sql, /FROM mailing_attempts/);
  }
});

test('a claim records a unique lease atomically; only that lease may finish its attempt', async () => {
  const f = fixture(sql => {
    if (sql.includes('FROM mailing_settings')) return [{ enabled: 1, per_minute: 30, per_day: 1000 }];
    if (sql.includes('FROM mailing_attempts')) return [{ minute_count: 0, day_count: 1 }];
    if (sql.includes('JOIN mailing_campaigns')) return [{ ...row(), id: 'delivery', campaign_id: 'campaign', user_id: 'u1', channel: 'email', recipient_kind: 'user', attempts: 2, public_token: 'a'.repeat(64) }];
    return { affectedRows: 1 };
  });
  const job = (await f.repository.claim(NOW))!; assert.equal(job.attempts, 3); assert.equal(job.recipientKind, 'user');
  const record = f.calls.find(c => c.sql.startsWith('INSERT INTO mailing_attempts'))!; assert.equal(record.params[1], job.lease);
  await f.repository.finish(job, 'sent', null, NOW);
  const finish = f.calls.find(c => c.sql.includes("AND lease_token=?"))!;
  assert.equal(finish.params.at(-1), job.lease); assert.match(finish.sql, /status='sending'/);
  const expired = fixture(() => ({ affectedRows: 0 })); await expired.repository.finish(job, 'sent', null, NOW);
  assert.equal(expired.calls.length, 1);
});

test('retry updates only failed deliveries; suppression and contact filters remain parameterized', async () => {
  const f = fixture(sql => sql.startsWith('SELECT status') ? [{ status: 'done' }] : { affectedRows: 2 });
  await f.repository.retry('campaign', NOW);
  assert.match(f.calls[1]!.sql, /status='failed'/); assert.doesNotMatch(f.calls[1]!.sql, /attempted_at=NULL/);
  const search = "x' OR 1=1 --";
  const g = fixture(sql => sql.startsWith('SELECT COUNT') ? [{ total: 0 }] : []);
  await g.repository.listContacts({ search }, 1);
  assert.equal(g.calls[0]!.sql.includes(search), false); assert.equal(g.calls[0]!.params[0], `%${search}%`);
  const removed = exampleJob({ userId: null }); assert.equal(await g.repository.recipientAvailable(removed), false);
  assert.equal(await g.repository.recipientAvailable(exampleJob()), false);
});


test('minute reservations survive Moscow midnight while yesterday attempts do not consume the new daily budget', async () => {
  const midnight = new Date('2026-11-02T00:00:10+03:00');
  for (const scenario of [{ count: 30, age: 30_000, limited: true }, { count: 1000, age: 120_000, limited: false }]) {
    const db = new Database(':memory:'); db.exec('CREATE TABLE mailing_attempts (attempted_at INTEGER)');
    const insert = db.prepare('INSERT INTO mailing_attempts VALUES (?)');
    for (let i = 0; i < scenario.count; i++) insert.run(midnight.getTime() - scenario.age);
    const f = fixture((sql, params) => {
      if (sql.includes('FROM mailing_settings')) return [{ enabled: 1, per_minute: 30, per_day: 1000 }];
      // Execute the actual portable aggregation against stored history, not a canned counter.
      if (sql.includes('FROM mailing_attempts')) return [db.prepare(sql).get(...params.map(p => p instanceof Date ? p.getTime() : p))];
      if (sql.includes('JOIN mailing_campaigns')) return [{ ...row(), id: 'delivery', campaign_id: 'campaign', user_id: 'u1', channel: 'email', recipient_kind: 'user', attempts: 0, public_token: 'a'.repeat(64) }];
      return { affectedRows: 1 };
    });
    try {
      const job = await f.repository.claim(midnight);
      assert.equal(job === null, scenario.limited);
    } finally { db.close(); }
  }
});


test('public opt-out and administrator removal keep contact status and suppression atomic without reactivating bounces', async () => {
  const f = fixture(sql => sql.startsWith('SELECT email') ? [{ email: 'alex@example.com' }] : { affectedRows: 1 });
  assert.equal(await f.repository.unsubscribe('a'.repeat(64)), true);
  assert.match(f.calls[1]!.sql, /INSERT INTO mailing_suppressions/);
  assert.match(f.calls[2]!.sql, /SET status='unsubscribed'.*status='active'/);
  assert.deepEqual(f.events, ['begin', 'commit', 'release']);
  await f.repository.unsuppress('alex@example.com');
  assert.match(f.calls[3]!.sql, /DELETE FROM mailing_suppressions/);
  assert.match(f.calls[4]!.sql, /SET status='active'.*status='unsubscribed'/);
  assert.deepEqual(f.calls[4]!.params, ['alex@example.com']);
  assert.deepEqual(f.events.slice(-3), ['begin', 'commit', 'release']);
});
