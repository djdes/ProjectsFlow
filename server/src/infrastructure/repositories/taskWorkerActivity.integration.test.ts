import assert from 'node:assert/strict';
import { test } from 'node:test';
import mysql from 'mysql2/promise';
import { MysqlTaskWorkerActivityRepository } from './MysqlTaskWorkerActivityRepository.js';

// Connection-local tables only. Run explicitly with PF_WORKER_ACTIVITY_DB=1.
test('MariaDB: cards show the latest run and unanswered questions, excluding done, deleted and foreign tasks', {
  skip: process.env.PF_WORKER_ACTIVITY_DB !== '1',
}, async () => {
  const db = await mysql.createConnection({
    ...(process.env.DB_SOCKET ? { socketPath: process.env.DB_SOCKET } : { host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306) }),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, timezone: 'Z',
  });
  try {
    await db.query("SET time_zone='+00:00'");
    await db.query('CREATE TEMPORARY TABLE tasks (id CHAR(36), project_id CHAR(36), status VARCHAR(32), deleted_at TIMESTAMP NULL)');
    await db.query('CREATE TEMPORARY TABLE live_sessions (id CHAR(36),task_id CHAR(36),project_id CHAR(36),status VARCHAR(32),started_at TIMESTAMP,ended_at TIMESTAMP NULL,base_seq INT,attempt INT)');
    await db.query('CREATE TEMPORARY TABLE task_comments (id CHAR(36),task_id CHAR(36),actor_kind VARCHAR(16),body TEXT,created_at TIMESTAMP)');
    for (const [id, project, status, deleted] of [
      ['retry', 'p', 'in_progress', null], ['error', 'p', 'in_progress', null], ['question', 'p', 'awaiting_clarification', null],
      ['done', 'p', 'done', null], ['deleted', 'p', 'in_progress', '2026-10-23 10:00:00'], ['foreign', 'other', 'in_progress', null],
    ]) await db.query('INSERT INTO tasks VALUES (?,?,?,?)', [id, project, status, deleted]);
    for (const [id, task, project, status, base] of [
      ['old-failure', 'retry', 'p', 'failed', 1], ['new-run', 'retry', 'p', 'running', 10], ['failed', 'error', 'p', 'failed', 1],
      ['done-run', 'done', 'p', 'failed', 1], ['deleted-run', 'deleted', 'p', 'failed', 1], ['foreign-run', 'foreign', 'other', 'failed', 1],
    ]) await db.query("INSERT INTO live_sessions VALUES (?,?,?,?,'2026-10-23 10:00:00',NULL,?,1)", [id, task, project, status, base]);
    for (const taskId of ['question', 'done', 'deleted', 'foreign']) {
      await db.query("INSERT INTO task_comments VALUES (?,?,'agent',?,'2026-10-23 10:01:00')", [`q-${taskId}`, taskId, '<!-- ralph-question {"id":"q1"} -->Вопрос']);
    }
    const repo = new MysqlTaskWorkerActivityRepository(db as unknown as mysql.Pool);
    const states = async () => (await repo.listByProject('p')).map(row => [row.taskId, row.state, row.sessionId]).sort();
    assert.deepEqual(await states(), [['error', 'error', 'failed'], ['question', 'question', null], ['retry', 'running', 'new-run']]);
    await db.query("INSERT INTO task_comments VALUES ('answer','question','user',?,'2026-10-23 10:02:00')", ['<!-- ralph-answer {"q":"q1","value":"Да"} -->']);
    assert.deepEqual(await states(), [['error', 'error', 'failed'], ['retry', 'running', 'new-run']]);
    await db.query("UPDATE live_sessions SET status='completed',ended_at='2026-10-23 10:03:00' WHERE id='new-run'");
    assert.deepEqual(await states(), [['error', 'error', 'failed']]);
  } finally { await db.end(); }
});
