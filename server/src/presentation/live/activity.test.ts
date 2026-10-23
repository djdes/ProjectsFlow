import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { GetProjectWorkerActivity } from '../../application/live/GetProjectWorkerActivity.js';
import { liveUserRouter } from './routes.js';
import { errorHandler } from '../middleware/errorHandler.js';

test('activity API verifies project read access before exposing worker questions or errors', async () => {
  let reads = 0;
  const activities = [{ taskId: 't', state: 'question' as const, sessionId: null, questionCommentId: 'q' }];
  const activity = new GetProjectWorkerActivity({
    projects: { getById: async (id: string) => ({ id }) } as never,
    members: { findForProject: async (p: string, u: string) => p === 'allowed' && u === 'viewer' ? { role: 'viewer' } : null } as never,
    activity: { listByProject: async () => { reads++; return activities; } },
  });
  const app = express();
  app.use((req, _res, next) => { if (req.headers['x-test-user']) req.user = { id: req.headers['x-test-user'] } as never; next(); });
  app.use('/api/projects', liveUserRouter({ service: {} as never, liveEventHub: {} as never, activity }));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects`;
  try {
    assert.equal((await fetch(`${base}/allowed/live/activity`)).status, 401);
    assert.equal((await fetch(`${base}/private/live/activity`, { headers: { 'x-test-user': 'viewer' } })).status, 404);
    assert.equal(reads, 0);
    const response = await fetch(`${base}/allowed/live/activity`, { headers: { 'x-test-user': 'viewer' } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { activities });
    assert.equal(reads, 1);
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
});
