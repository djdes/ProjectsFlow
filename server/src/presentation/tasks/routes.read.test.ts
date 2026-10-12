import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import express from 'express';
import { GetTask } from '../../application/task/GetTask.js';
import { tasksRouter } from './routes.js';
import { errorHandler } from '../middleware/errorHandler.js';

test('direct task notification URL authorizes approvers without exposing the inbox or creator audit id', async () => {
  const task = { id: 't1', projectId: 'private-inbox', createdBy: 'worker', description: 'Поручение',
    assignee: { userId: 'worker' }, createdAt: new Date(), updatedAt: new Date(), ralphCancelRequestedAt: null };
  const getTask = new GetTask({
    projects: { getById: async () => ({ id: 'private-inbox', isInbox: true, ownerId: 'worker' }) } as never,
    tasks: { getById: async () => task } as never,
    members: { listApproverUserIdsForProject: async () => ['lead'], listSharedUsers: async () => [{ id: 'worker' }] } as never,
  });
  const app = express();
  app.use((req, _res, next) => { if (req.headers['x-test-user']) req.user = { id: req.headers['x-test-user'] } as never; next(); });
  app.use('/api/projects/:projectId/tasks', tasksRouter({ getTask, maxAttachmentBytes: 1024 } as never));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects`;
  try {
    const allowed = await fetch(`${base}/private-inbox/tasks/t1`, { headers: { 'x-test-user': 'lead' } });
    assert.equal(allowed.status, 200);
    const body = await allowed.json() as { task: { id: string; canEdit: boolean; createdBy?: string } };
    assert.equal(body.task.id, 't1');
    assert.equal(body.task.canEdit, true);
    assert.equal(body.task.createdBy, undefined);
    const denied = await fetch(`${base}/private-inbox/tasks/t1`, { headers: { 'x-test-user': 'colleague' } });
    assert.equal(denied.status, 404);
    const wrongProject = await fetch(`${base}/other/tasks/t1`, { headers: { 'x-test-user': 'lead' } });
    assert.equal(wrongProject.status, 404);
    const anonymous = await fetch(`${base}/private-inbox/tasks/t1`);
    assert.equal(anonymous.status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
