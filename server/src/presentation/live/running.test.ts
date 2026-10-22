import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LiveService, type LiveServiceDeps } from '../../application/live/LiveService.js';
import { liveUserRouter } from './routes.js';
import { errorHandler } from '../middleware/errorHandler.js';

test('running tasks API requires authentication and project access before reading activity', async () => {
  const reads: string[] = [];
  const service = new LiveService({
    access: {
      projects: { async getById(id: string) { return { id }; } },
      members: { async findForProject(projectId: string, userId: string) { return projectId === 'allowed' && userId === 'member' ? { projectId, userId, role: 'viewer' } : null; } },
    },
    repo: { async listRunningTaskIds(projectId: string) { reads.push(projectId); return ['running-task']; } },
  } as unknown as LiveServiceDeps);
  const app = express();
  app.use((req, _res, next) => { if (req.headers['x-test-user']) req.user = { id: String(req.headers['x-test-user']) } as NonNullable<typeof req.user>; next(); });
  app.use('/api/projects', liveUserRouter({ service, liveEventHub: {} as never }));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects`;
  try {
    assert.equal((await fetch(`${base}/allowed/live/running`)).status, 401);
    assert.equal((await fetch(`${base}/private/live/running`, { headers: { 'x-test-user': 'member' } })).status, 404);
    assert.deepEqual(reads, []);
    const result = await fetch(`${base}/allowed/live/running`, { headers: { 'x-test-user': 'member' } });
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { taskIds: ['running-task'] });
    assert.deepEqual(reads, ['allowed']);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
