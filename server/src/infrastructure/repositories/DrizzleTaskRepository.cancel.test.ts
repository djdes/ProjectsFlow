import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import type { SQL } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { TASK_STATUSES } from '../../domain/task/Task.js';
import { DrizzleTaskRepository } from './DrizzleTaskRepository.js';

function harness() {
  const patches: Record<string, unknown>[] = [];
  const conditions: { sql: string; params: unknown[] }[] = [];
  const chain = {
    set: (patch: Record<string, unknown>) => { patches.push(patch); return chain; },
    where: async (condition: SQL) => {
      conditions.push(new MySqlDialect().sqlToQuery(condition));
      return [{ affectedRows: 1 }];
    },
  };
  const repository = new DrizzleTaskRepository({ update: () => chain } as unknown as Database);
  repository.getById = async () => null;
  return { repository, patches, conditions };
}

test('requeue/finish clears the previous cancellation atomically, active moves preserve it', async () => {
  for (const status of TASK_STATUSES) {
    const h = harness();
    await h.repository.update('task', { status });
    assert.equal(h.patches[0]?.status, status);
    const active = status === 'in_progress' || status === 'awaiting_clarification';
    for (const field of ['ralphCancelRequestedAt', 'ralphCancelRequestedBy']) {
      assert.equal(h.patches[0]?.[field], active ? undefined : null, `${status}: ${field}`);
    }
    assert.match(h.conditions[0]!.sql, /deleted_at.*is null/);
  }
});

test('editing a description does not revoke an active cancellation', async () => {
  const h = harness();
  await h.repository.update('task', { description: 'Updated' });
  assert.deepEqual(h.patches, [{ description: 'Updated' }]);
});

test('bulk requeue clears cancellation, bulk active moves preserve it', async () => {
  for (const to of ['todo', 'backlog', 'in_progress', 'awaiting_clarification'] as const) {
    const h = harness();
    await h.repository.bulkChangeStatus(['project'], 'in_progress', to);
    assert.equal(h.patches[0]?.ralphCancelRequestedAt,
      to === 'todo' || to === 'backlog' ? null : undefined);
    assert.equal(h.patches[0]?.ralphCancelRequestedBy,
      to === 'todo' || to === 'backlog' ? null : undefined);
  }
});

test('late cancellation requires an active task or a matching running session, and never done', async () => {
  const h = harness();
  await h.repository.requestRalphCancel('task', 'user');
  const condition = h.conditions[0]!;
  assert.match(condition.sql, /`tasks`.`status` IN/);
  assert.match(condition.sql, /`tasks`.`ralph_cancel_requested_at` IS NULL/);
  assert.match(condition.sql, /'in_progress', 'awaiting_clarification'/);
  assert.match(condition.sql, /`tasks`.`status` <> 'done' AND EXISTS/);
  assert.match(condition.sql, /`live_sessions`.`task_id` = `tasks`.`id`/);
  assert.match(condition.sql, /`live_sessions`.`project_id` = `tasks`.`project_id`/);
  assert.match(condition.sql, /`live_sessions`.`status` = 'running'/);
});
