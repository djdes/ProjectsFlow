import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { agentApiRouter } from './apiRoutes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { BroadcastTelegramNotificationByTask } from '../../application/telegram/BroadcastTelegramNotificationByTask.js';
import { ReportTelegramWorkerResult } from '../../application/telegram/ReportTelegramWorkerResult.js';
import type { Task } from '../../domain/task/Task.js';
import type { TelegramTaskOriginRepository } from '../../application/telegram/TelegramTaskOriginRepository.js';

async function withServer(actor: string, run: (url: string, queued: string[]) => Promise<void>) {
  const queued: string[] = [];
  const task = { id: 'task', projectId: 'project', status: 'done', deletedAt: null, assignee: { userId: 'assignee', displayName: 'Олег' } } as Task;
  const tasks = { async getById() { return task; } };
  const origins = {
    async getByTask() { return { taskId: 'task', projectId: 'project', chatId: -100500, messageId: 42, requestedAt: null }; },
    async requestResult(id: string) { queued.push(id); },
    async listDue() { return []; },
  } as unknown as TelegramTaskOriginRepository;
  const workerResults = new ReportTelegramWorkerResult({
    tasks, origins,
    projects: { async getById() { return { id: 'project', dispatcherUserId: 'dispatcher' }; } } as never,
    members: {} as never,
    commits: { async listByTask() { return []; } },
    client: { async sendMessage() { throw new Error('No live Telegram sends in API tests'); } },
    now: () => new Date(), idGen: () => 'claim',
  });
  const broadcast = new BroadcastTelegramNotificationByTask({
    tasks,
    send: { async execute() { return { status: 'pref_off', kind: 'taskDone' }; } },
    members: { async listApproverUserIdsForProject() { return []; } },
    workerResults,
  });
  const app = express();
  app.use(express.json());
  app.use('/api/agent', agentApiRouter({
    authenticate: { async execute() { return { user: { id: actor }, token: { id: 'token', scopeKind: 'account' } }; } },
    broadcastTelegramByTask: broadcast,
  } as unknown as Parameters<typeof agentApiRouter>[0]));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/agent/notifications/telegram`, queued);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
  }
}

const completion = { taskId: 'task', kind: 'task_done', text: 'Готово', chatId: -999 };
const headers = { Authorization: 'Bearer pfat_test', 'Content-Type': 'application/json' };

test('agent API: dispatcher queues source-group result even with personal Telegram notifications disabled', async () => {
  await withServer('dispatcher', async (url, queued) => {
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(completion) });
    assert.equal(response.status, 200);
    assert.deepEqual(queued, ['task']);
  });
});

test('agent API: another project member cannot request a worker report', async () => {
  await withServer('member', async (url, queued) => {
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(completion) });
    assert.equal(response.status, 403);
    assert.deepEqual(queued, []);
  });
});

test('agent API: unauthenticated completion never queues a group report', async () => {
  await withServer('dispatcher', async (url, queued) => {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(completion) });
    assert.equal(response.status, 401);
    assert.deepEqual(queued, []);
  });
});
