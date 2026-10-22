import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { agentApiRouter } from './apiRoutes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import type { TaskStatus } from '../../domain/task/Task.js';

test('agent API forbids delegation, defaults to drafts and preserves existing worker progress', async () => {
  const writes: Record<string, unknown>[] = [];
  let status: TaskStatus = 'backlog';
  let resumed = false;
  const task = () => ({ id: 'task', projectId: 'project', status, createdAt: new Date(), updatedAt: new Date() });
  const app = express();
  app.use(express.json());
  app.use('/api/agent', agentApiRouter({
    authenticate: { async execute() { return { user: { id: 'actor' }, token: { id: 'token', scopeKind: 'account' } }; } },
    taskRepo: { async getById() { return task(); } },
    createTask: { async execute(input: Record<string, unknown>) { writes.push(input); return { ...task(), status: input.status }; } },
    moveTask: { async execute(input: Record<string, unknown>) { writes.push(input); return { ...task(), status: input.targetStatus }; } },
    createComment: { async execute(input: Record<string, unknown>) { writes.push(input); return { ...input, id: 'comment', createdAt: new Date(), updatedAt: new Date() }; } },
    maybeReopenForClarification: { async execute() { resumed = true; return null; } },
    notifyCommentAdded() {}, notifyStatusChanged() {},
  } as unknown as Parameters<typeof agentApiRouter>[0]));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/agent/projects/project/tasks`;
  const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { Authorization: 'Bearer pfat_test', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    for (const active of ['todo', 'in_progress', 'awaiting_clarification']) {
      const response = await post('', { description: 'Задача', status: active });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error, 'agent_task_dispatch_forbidden');
    }
    assert.equal(writes.length, 0);
    assert.equal((await post('', { description: 'Черновик' })).status, 201);
    assert.equal(writes.at(-1)?.status, 'backlog');
    for (const current of ['backlog', 'manual', 'pending_approval', 'done', 'custom_1'] as TaskStatus[]) {
      status = current;
      for (const targetStatus of ['todo', 'in_progress', 'awaiting_clarification']) {
        const before = writes.length;
        assert.equal((await post('/task/move', { targetStatus })).status, 403);
        assert.equal(writes.length, before, 'Forbidden transitions never mutate a task');
      }
    }
    status = 'todo';
    assert.equal((await post('/task/move', { targetStatus: 'in_progress' })).status, 200);
    status = 'in_progress';
    assert.equal((await post('/task/move', { targetStatus: 'todo' })).status, 403);
    assert.equal((await post('/task/move', { targetStatus: 'pending_approval' })).status, 200);
    assert.equal((await post('/task/move', { targetStatus: 'backlog' })).status, 200);
    status = 'awaiting_clarification';
    assert.equal((await post('/task/comments', { body: '<!-- ralph-answer {"id":"question","value":"retry"} -->' })).status, 201);
    assert.equal(resumed, false, 'Agent markers cannot resume the worker');
    assert.equal((await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: 'Без входа' }) })).status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
