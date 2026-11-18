import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import express from 'express';
import { AgentActivityTracker } from '../../application/agent/AgentActivityTracker.js';
import { tasksRouter } from './routes.js';
import { errorHandler } from '../middleware/errorHandler.js';

test('dispatcher-heartbeat: отдаёт последний визит диспетчера проекта только участнику задачи', async () => {
  const activity = new AgentActivityTracker(new Date('2026-11-18T10:00:00Z'));
  activity.touch('dispatcher', new Date('2026-11-18T10:05:00Z'));
  const getTask = { execute: async (_p: string, userId: string) => {
    if (userId !== 'member') throw Object.assign(new Error('nf'), { status: 404 });
    return {};
  } };
  const projectRepo = { getById: async () => ({ id: 'p1', dispatcherUserId: 'dispatcher' }) };
  const app = express();
  app.use((req, _res, next) => { if (req.headers['x-test-user']) req.user = { id: req.headers['x-test-user'] } as never; next(); });
  app.use('/api/projects/:projectId/tasks', tasksRouter({ getTask, projectRepo, agentActivity: activity, maxAttachmentBytes: 1024 } as never));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/p1/tasks/t1/dispatcher-heartbeat`;
  try {
    const ok = await fetch(base, { headers: { 'x-test-user': 'member' } });
    assert.equal(ok.status, 200);
    const body = await ok.json() as { dispatcherAssigned: boolean; lastSeenAt: string | null; trackedSince: string };
    assert.equal(body.dispatcherAssigned, true);
    assert.equal(body.lastSeenAt, '2026-11-18T10:05:00.000Z');
    assert.equal(body.trackedSince, '2026-11-18T10:00:00.000Z');
    const anonymous = await fetch(base);
    assert.equal(anonymous.status, 401);
    const stranger = await fetch(base, { headers: { 'x-test-user': 'stranger' } });
    assert.notEqual(stranger.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
