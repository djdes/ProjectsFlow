import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import type { Pool } from 'mysql2/promise';
import { MysqlTelegramWorkerResultOutbox } from './MysqlTelegramWorkerResultOutbox.js';

const now = new Date('2026-10-22T10:00:00Z');
const sqlDate = (d: Date) => d.toISOString().replace('T', ' ').replace('Z', '');
function harness() {
  const db = new DatabaseSync(':memory:');
  db.function('JSON_UNQUOTE', v => v);
  db.exec(`CREATE TABLE projects(id TEXT,dispatcher_user_id TEXT);
    CREATE TABLE tasks(id TEXT,project_id TEXT,status TEXT,deleted_at TEXT);
    CREATE TABLE activity_events(id TEXT,project_id TEXT,actor_user_id TEXT,kind TEXT,payload TEXT,created_at TEXT);
    CREATE TABLE live_sessions(id TEXT,task_id TEXT,project_id TEXT,agent_name TEXT,status TEXT,started_at TEXT,ended_at TEXT);
    CREATE TABLE telegram_worker_result_deliveries(id TEXT PRIMARY KEY,task_id TEXT,project_id TEXT,completion_key TEXT,source TEXT,
      tg_chat_id INTEGER,tg_message_id INTEGER,requested_at TEXT,sent_at TEXT,retry_at TEXT,claim_token TEXT,claim_until TEXT,UNIQUE(task_id,completion_key));
    INSERT INTO projects VALUES ('p','dispatcher'); INSERT INTO tasks VALUES ('t','p','pending_approval',NULL);`);
  const pool = { async query(sql: string, params: unknown[] = []) {
    // Execute production queries, adapting only MySQL interval/insert-ignore syntax.
    const translated = sql.replace('INSERT IGNORE', 'INSERT OR IGNORE')
      .replaceAll('? + INTERVAL 1 SECOND', "datetime(?, '+1 second')")
      .replaceAll('? - INTERVAL 1 SECOND', "datetime(?, '-1 second')");
    const values = params.map(v => v instanceof Date ? sqlDate(v) : v) as Array<string | number | null>;
    const statement = db.prepare(translated);
    if (!sql.trim().startsWith('SELECT')) return [{ affectedRows: Number(statement.run(...values).changes) }];
    return [statement.all(...values).map(row => Object.fromEntries(Object.entries(row).map(([k,v]) =>
      [k, ['created_at','started_at','requested_at'].includes(k) && typeof v === 'string' ? new Date(v.replace(' ', 'T') + 'Z') : v])))];
  } } as unknown as Pool;
  const repo = new MysqlTelegramWorkerResultOutbox(pool);
  const event = (id = 'event', actor = 'dispatcher', oldStatus = 'in_progress', newStatus = 'pending_approval', at = '2026-10-22 09:59:00') =>
    db.prepare('INSERT INTO activity_events VALUES (?,?,?,?,?,?)').run(id, 'p', actor, 'task_status_changed', JSON.stringify({ taskId: 't', oldStatus, newStatus }), at);
  const session = (status = 'completed', agent = 'ralph-worker') => db.prepare('INSERT INTO live_sessions VALUES (?,?,?,?,?,?,?)')
    .run('session','t','p',agent,status,'2026-10-22 09:00:00','2026-10-22 09:59:30');
  return { db, repo, event, session };
}

test('SQL completion identity survives final approval and a missed LIVE finish during server restart', async () => {
  const h = harness();
  try {
    h.event(); h.session('timeout');
    h.event('approved','dispatcher','pending_approval','done','2026-10-22 10:00:00');
    assert.equal((await h.repo.findCompletion('t','p'))?.key, 'session:session');
    assert.deepEqual(await h.repo.listRecoverable(now, 100), ['t']);
    assert.equal(await h.repo.findCompletion('t','other-project'), null);
  } finally { h.db.close(); }
});

test('SQL recovery excludes human completions and failed/canceled workers, supports LIVE-disabled runs', async () => {
  for (const status of ['failed','canceled','human','no-live','demo']) {
    const h = harness();
    try {
      h.event('event', status === 'human' ? 'member' : 'dispatcher');
      if (status !== 'no-live') h.session(status === 'demo' ? 'completed' : status, status === 'demo' ? 'demo' : 'ralph-worker');
      const result = await h.repo.findCompletion('t','p');
      if (['failed','canceled','human'].includes(status)) assert.equal(result, null, status);
      else assert.equal(result?.key, 'event:event', status);
      if (status === 'human') assert.deepEqual(await h.repo.listRecoverable(now, 100), []);
    } finally { h.db.close(); }
  }
});

test('SQL outbox persists per-run deduplication, retry deadlines and independent claim tokens', async () => {
  const h = harness();
  const delivery = { id: 'first',taskId:'t',projectId:'p',completionKey:'session:first',source:'workspace' as const,chatId:-100123,messageId:null,requestedAt:now };
  try {
    await h.repo.enqueue(delivery);
    await h.repo.enqueue({ ...delivery,id:'duplicate' });
    assert.equal((await h.repo.listDue(now,20)).length,1);
    const until = new Date(now.getTime()+60_000);
    assert.equal(await h.repo.claim('first','owner',now,until),true);
    assert.equal(await h.repo.claim('first','other',now,until),false);
    await h.repo.retry('first','owner',until);
    assert.equal((await h.repo.listDue(now,20)).length,0);
    assert.equal((await h.repo.listDue(until,20)).length,1);
    await h.repo.enqueue({ ...delivery,id:'second',completionKey:'session:second' });
    await h.repo.claim('second','new-owner',now,until);
    await h.repo.finish('second','owner',now);
    await h.repo.finish('second','new-owner',now);
    await h.repo.claim('first','retry-owner',until,new Date(until.getTime()+60_000));
    await h.repo.finish('first','retry-owner',until);
    assert.deepEqual(await h.repo.listDue(until,20),[]);
  } finally { h.db.close(); }
});
