import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import express from 'express';
import { MoveTaskToProject } from '../../application/task/MoveTaskToProject.js';
import { tasksRouter } from './routes.js';
import { errorHandler } from '../middleware/errorHandler.js';

test('personal task transfer API checks task participation and destination access', async () => {
  const targetId = '22222222-2222-4222-8222-222222222222';
  const task = { id: 't1', projectId: 'private-inbox', createdBy: 'worker', description: 'Поручение',
    assignee: { userId: 'worker' }, createdAt: new Date(), updatedAt: new Date(), ralphCancelRequestedAt: null };
  const mutations: string[] = [];
  const refreshed: string[] = [];
  const assignToProject = new MoveTaskToProject({
    projects: { getById: async (id: string) => ({ id, isInbox: id === 'private-inbox', ownerId: 'worker' }) } as never,
    members: {
      listApproverUserIdsForProject: async () => ['lead', 'lead-readonly'],
      findForProject: async (id: string, userId: string) => id === targetId ? { role: userId === 'lead-readonly' ? 'viewer' : 'editor' } : null,
    } as never,
    tasks: {
      getById: async () => task,
      moveToProject: async (_id: string, projectId: string, assignee: string) => {
        mutations.push(projectId);
        return { ...task, projectId, assignee: { userId: assignee } };
      },
    } as never,
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { if (req.headers['x-test-user']) req.user = { id: req.headers['x-test-user'] } as never; next(); });
  app.use('/api/projects/:projectId/tasks', tasksRouter({ assignToProject, notifyTaskChanged: (id: string) => refreshed.push(id), maxAttachmentBytes: 1024 } as never));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/private-inbox/tasks/t1/assign-to-project`;
  const transfer = (actor?: string) => fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(actor ? { 'x-test-user': actor } : {}) },
    body: JSON.stringify({ targetProjectId: targetId }),
  });
  try {
    assert.equal((await transfer('colleague')).status, 404);
    assert.equal((await transfer('lead-readonly')).status, 403);
    assert.equal((await transfer()).status, 401);
    assert.deepEqual(mutations, []);
    const allowed = await transfer('lead');
    assert.equal(allowed.status, 200);
    const body = await allowed.json() as { task: { projectId: string; assignee: { userId: string } } };
    assert.equal(body.task.projectId, targetId);
    assert.equal(body.task.assignee.userId, 'worker');
    assert.deepEqual(mutations, [targetId]);
    assert.deepEqual(refreshed, ['private-inbox', targetId]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
