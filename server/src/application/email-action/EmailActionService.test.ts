import assert from 'node:assert/strict';
import test from 'node:test';
import type { Task, TaskStatus } from '../../domain/task/Task.js';
import type { EmailActionToken } from './EmailActionTokenRepository.js';
import { EmailActionService } from './EmailActionService.js';

function fixture(status: TaskStatus, used = false) {
  let moveCalls = 0;
  let markCalls = 0;
  const token: EmailActionToken = { id: 'token-id', token: 'token', action: 'complete', taskId: 'task', projectId: 'project', userId: 'employee', usedAt: used ? new Date(0) : null, expiresAt: new Date(10000) };
  const task = { id: 'task', status, description: 'Задача' } as Task;
  const service = new EmailActionService({
    tokens: { create: async () => {}, findByToken: async () => token, markUsed: async () => { markCalls++; } },
    tasks: { getById: async () => task } as never,
    moveTask: { execute: async (input: { ownerUserId: string }) => { assert.equal(input.ownerUserId, 'employee'); moveCalls++; return task; } } as never,
    createTaskComment: {} as never,
    now: () => new Date(1000),
  });
  return { service, counts: () => ({ moveCalls, markCalls }) };
}

test('digest completion reports the approval status returned by the task policy', async () => {
  const h = fixture('pending_approval');
  assert.deepEqual(await h.service.complete('token'), { kind: 'pending_approval', projectId: 'project', taskId: 'task' });
  assert.deepEqual(h.counts(), { moveCalls: 1, markCalls: 1 });
});

test('an approver completion still reports done', async () => {
  const h = fixture('done');
  assert.deepEqual(await h.service.complete('token'), { kind: 'done', projectId: 'project', taskId: 'task' });
});

test('a used action reads the current status instead of claiming approval', async () => {
  const h = fixture('pending_approval', true);
  assert.deepEqual(await h.service.complete('token'), { kind: 'used', taskStatus: 'pending_approval' });
  assert.deepEqual(h.counts(), { moveCalls: 0, markCalls: 0 });
  const preview = await h.service.preview('token');
  assert.ok(preview.kind === 'ok');
  assert.equal(preview.taskStatus, 'pending_approval');
});

test('a reopened task is not shown as done by its used completion action', async () => {
  const h = fixture('manual', true);
  assert.deepEqual(await h.service.complete('token'), { kind: 'used', taskStatus: 'manual' });
});