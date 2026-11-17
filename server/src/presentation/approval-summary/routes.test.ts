import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import express from 'express';
import { GetApprovalSummary } from '../../application/approval-summary/GetApprovalSummary.js';
import { LlmRateLimitedError } from '../../domain/llm/errors.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { approvalSummaryRouter } from './routes.js';

async function withServer(
  options: { status: string; llmError?: Error },
  run: (base: string, calls: { count: number }) => Promise<void>,
): Promise<void> {
  const calls = { count: 0 };
  const get = new GetApprovalSummary({
    projects: { getById: async () => ({ id: 'p1', isInbox: false, ownerId: 'lead' }) } as never,
    members: {
      findForProject: async (_p: string, userId: string) => (userId === 'lead' ? { projectId: 'p1', userId, role: 'owner', joinedAt: new Date() } : null),
    } as never,
    tasks: {
      getById: async () => ({
        id: 't1',
        projectId: 'p1',
        description: 'Сверстать страницу врачей',
        status: options.status,
        assignee: { userId: 'worker', displayName: 'Борис', avatarUrl: null },
      }),
    } as never,
    live: { listSessions: async () => [], listEvents: async () => [] },
    taskCommits: {
      listByTask: async () => [
        {
          taskId: 't1',
          sha: 'abc1234def',
          message: 'feat: страница врачей',
          authorName: 'Борис',
          authorAvatarUrl: null,
          htmlUrl: 'https://github.com/acme/site/commit/abc1234def',
          committedAt: new Date('2026-11-16T10:00:00Z'),
          linkedAt: new Date('2026-11-16T10:00:00Z'),
        },
      ],
    },
    comments: { listByTask: async () => [] },
    summaries: { find: async () => null, save: async () => {} },
    llm: {
      async generate() {
        calls.count++;
        if (options.llmError) throw options.llmError;
        return { text: 'Добавлена страница врачей.', model: 'fake', usage: null, costUsd: null };
      },
    },
    now: () => new Date('2026-11-17T09:00:00Z'),
  });
  const app = express();
  app.use((req, _res, next) => {
    if (req.headers['x-test-user']) req.user = { id: req.headers['x-test-user'] } as never;
    next();
  });
  app.use('/api/projects', approvalSummaryRouter({ get }));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects`;
  try {
    await run(base, calls);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('GET approval-summary returns the summary for a reader and hides the task from outsiders', async () => {
  await withServer({ status: 'pending_approval' }, async (base, calls) => {
    const ok = await fetch(`${base}/p1/tasks/t1/approval-summary`, { headers: { 'x-test-user': 'lead' } });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { summary: 'Добавлена страница врачей.', generatedAt: '2026-11-17T09:00:00.000Z' });

    const outsider = await fetch(`${base}/p1/tasks/t1/approval-summary`, { headers: { 'x-test-user': 'stranger' } });
    assert.equal(outsider.status, 404);
    const anonymous = await fetch(`${base}/p1/tasks/t1/approval-summary`);
    assert.equal(anonymous.status, 401);
    assert.equal(calls.count, 1);
  });
});

test('GET approval-summary answers 200 with null when the task is not pending or the subscription is out', async () => {
  await withServer({ status: 'in_progress' }, async (base, calls) => {
    const res = await fetch(`${base}/p1/tasks/t1/approval-summary`, { headers: { 'x-test-user': 'lead' } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { summary: null, generatedAt: null });
    assert.equal(calls.count, 0);
  });
  await withServer({ status: 'pending_approval', llmError: new LlmRateLimitedError(null) }, async (base) => {
    const res = await fetch(`${base}/p1/tasks/t1/approval-summary`, { headers: { 'x-test-user': 'lead' } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { summary: null, generatedAt: null });
  });
});
