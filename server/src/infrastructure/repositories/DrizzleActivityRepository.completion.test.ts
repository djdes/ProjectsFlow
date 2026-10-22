import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import type { SQL } from 'drizzle-orm';
import { DrizzleActivityRepository } from './DrizzleActivityRepository.js';
import type { Database } from '../db/index.js';

// Execute the real parameterized SQL. These queries use portable UNION/COUNT/JOIN;
// SQLite's JSON_EXTRACT already unquotes scalars, so JSON_UNQUOTE is an identity.
function harness() {
  const db = new DatabaseSync(':memory:');
  db.function('JSON_UNQUOTE', value => value);
  db.exec(`
    CREATE TABLE tasks(id TEXT, project_id TEXT, assignee_user_id TEXT, status TEXT, deleted_at TEXT);
    CREATE TABLE projects(id TEXT, workspace_id TEXT);
    CREATE TABLE activity_events(actor_user_id TEXT, workspace_id TEXT, kind TEXT, created_at TEXT, payload TEXT);
    CREATE TABLE live_sessions(task_id TEXT, project_id TEXT, status TEXT, ended_at TEXT);
    INSERT INTO projects VALUES ('p', 'w'), ('other-project', 'other-workspace');
  `);
  const adapter = { async execute(statement: SQL) {
    const query = new MySqlDialect().sqlToQuery(statement);
    return [db.prepare(query.sql).all(...query.params as Array<string | number | null>), []];
  } } as unknown as Database;
  const repo = new DrizzleActivityRepository(adapter, {} as never);
  const task = (id: string, status = 'pending_approval', assignee = 'me', project = 'p', deleted: string | null = null) => db.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?, ?)').run(id, project, assignee, status, deleted);
  const worker = (id: string, status = 'completed', ended: string | null = '2026-10-22 09:00:00', project = 'p') => db.prepare('INSERT INTO live_sessions VALUES (?, ?, ?, ?)').run(id, project, status, ended);
  const manual = (id: string, actor = 'me', workspace = 'w') => db.prepare('INSERT INTO activity_events VALUES (?, ?, ?, ?, ?)').run(actor, workspace, 'task_status_changed', '2026-10-22 09:00:00', JSON.stringify({ taskId: id, newStatus: 'pending_approval' }));
  const count = (workspace = 'w', user = 'me') => repo.countTasksCompletedByActorSince(user, new Date('2026-10-21T21:00:00Z'), workspace);
  return { db, repo, task, worker, manual, count };
}

test('legacy worker completion is credited to the responsible user without rewriting the dispatcher audit actor', async () => {
  const h = harness();
  try { h.task('t'); h.worker('t'); h.manual('t', 'dispatcher'); assert.equal(await h.count(), 1); }
  finally { h.db.close(); }
});

test('worker retries, final approval and manual/worker overlap count a task once', async () => {
  const h = harness();
  try { h.task('t', 'done'); h.worker('t'); h.worker('t'); h.manual('t'); h.manual('t'); assert.equal(await h.count(), 1); }
  finally { h.db.close(); }
});

test('returned work and deleted tasks lose credit even if their worker run succeeded', async () => {
  const h = harness();
  try {
    for (const status of ['backlog', 'todo', 'in_progress', 'awaiting_clarification']) { h.task(status, status); h.worker(status); h.manual(status); }
    h.task('deleted', 'done', 'me', 'p', '2026-10-22'); h.worker('deleted'); h.manual('deleted');
    assert.equal(await h.count(), 0);
  } finally { h.db.close(); }
});

test('running, failed, canceled, timed out and previous-day runs are not completed today', async () => {
  const h = harness();
  try {
    for (const status of ['running', 'failed', 'canceled', 'timeout']) { h.task(status); h.worker(status, status); }
    h.task('yesterday'); h.worker('yesterday', 'completed', '2026-10-21 20:59:59');
    h.task('unfinished'); h.worker('unfinished', 'completed', null);
    assert.equal(await h.count(), 0);
  } finally { h.db.close(); }
});

test('credits cannot cross assignees, workspaces or a mismatched project/session pair', async () => {
  const h = harness();
  try {
    h.task('other-user', 'done', 'someone'); h.worker('other-user');
    h.task('other-space', 'done', 'me', 'other-project'); h.worker('other-space', 'completed', '2026-10-22 09:00:00', 'other-project');
    h.task('wrong-project'); h.worker('wrong-project', 'completed', '2026-10-22 09:00:00', 'other-project');
    assert.equal(await h.count(), 0);
    assert.equal(await h.count('other-workspace'), 1);
    assert.equal(await h.count('w', 'someone'), 1);
  } finally { h.db.close(); }
});

test('profile statistics share the same credit rules while retaining manual completions', async () => {
  const h = harness();
  try {
    h.task('manual'); h.manual('manual'); h.task('worker'); h.worker('worker');
    h.task('both'); h.manual('both'); h.worker('both');
    assert.equal(await h.count(), 3);
    assert.deepEqual(await h.repo.countCompletedByActorPerWorkspaceSince('me', new Date('2026-10-21T21:00:00Z')), [{ workspaceId: 'w', count: 3 }]);
  } finally { h.db.close(); }
});
