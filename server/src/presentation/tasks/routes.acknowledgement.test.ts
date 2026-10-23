import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import express from 'express';
import { AcknowledgeTaskComment } from '../../application/task/AcknowledgeTaskComment.js';
import { ListTaskComments } from '../../application/task/ListTaskComments.js';
import type { CommentAcknowledgement } from '../../domain/task/CommentAcknowledgement.js';
import { tasksRouter } from './routes.js';
import { errorHandler } from '../middleware/errorHandler.js';

test('comment acceptance: authenticated viewer, own identity, idempotence, isolation and reversible state', async () => {
  const acknowledgements: CommentAcknowledgement[] = [];
  const changes: readonly string[][] = [];
  let writes = 0;
  const task = { id: 't1', projectId: 'p1', status: 'pending_approval', assignee: { userId: 'worker' } };
  const comment = { id: 'c1', taskId: 't1', ownerUserId: 'author', body: 'Проверьте результат', actorKind: 'user',
    createdAt: new Date(), updatedAt: new Date() };
  const deps = {
    projects: { getById: async (id: string) => id === 'p1' ? { id, isInbox: false } : null } as never,
    tasks: { getById: async (id: string) => id === 't1' ? task : null } as never,
    members: { findForProject: async (_p: string, uid: string) => ['viewer', 'author'].includes(uid) ? { role: 'viewer' } : null } as never,
    comments: { getById: async (id: string) => id === 'c1' ? comment : id === 'foreign' ? { ...comment, id, taskId: 't2' } : null,
      listByTask: async () => [comment] } as never,
    attachments: { listByCommentIds: async () => new Map() } as never,
    acknowledgements: {
      async set(commentId: string, userId: string, accepted: boolean) {
        writes++;
        const i = acknowledgements.findIndex(a => a.commentId === commentId && a.userId === userId);
        if (accepted && i < 0) acknowledgements.push({ commentId, userId, displayName: userId, acknowledgedAt: new Date() });
        if (!accepted && i >= 0) acknowledgements.splice(i, 1);
      },
      async listByComments(ids: readonly string[]) { return acknowledgements.filter(a => ids.includes(a.commentId)); },
    },
    onChanged: (_p: string, ids: readonly string[]) => { (changes as string[][]).push([...ids]); },
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { if (req.headers['x-test-user']) req.user = { id: req.headers['x-test-user'] } as never; next(); });
  app.use('/api/projects/:projectId/tasks', tasksRouter({
    acknowledgeComment: new AcknowledgeTaskComment(deps), listComments: new ListTaskComments(deps), maxAttachmentBytes: 1024,
  } as never));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects`;
  const path = '/p1/tasks/t1/comments/c1/acknowledgement';
  const call = (method: string, userId?: string, suffix = path) => fetch(`${base}${suffix}`, {
    method, headers: { 'content-type': 'application/json', ...(userId ? { 'x-test-user': userId } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify({ userId: 'author', accepted: false }),
  });
  try {
    assert.equal((await call('PUT')).status, 401);
    assert.equal((await call('PUT', 'stranger')).status, 404);
    assert.equal((await call('PUT', 'viewer', path.replace('/p1/', '/other/'))).status, 404);
    assert.equal((await call('PUT', 'viewer', path.replace('/t1/', '/t2/'))).status, 404);
    assert.equal((await call('PUT', 'viewer', path.replace('/c1/', '/foreign/'))).status, 404);
    assert.equal((await call('PUT', 'viewer', path.replace('/c1/', '/missing/'))).status, 404);
    assert.equal(writes, 0);
    const accepted = await call('PUT', 'viewer');
    assert.equal(accepted.status, 200);
    const body = await accepted.json() as { acknowledgements: { userId: string; acknowledgedAt: string }[] };
    assert.deepEqual(body.acknowledgements.map(a => a.userId), ['viewer']);
    assert.ok(!Number.isNaN(Date.parse(body.acknowledgements[0]!.acknowledgedAt)));
    assert.equal((await call('PUT', 'viewer')).status, 200);
    assert.equal(acknowledgements.length, 1);
    const list = await call('GET', 'author', '/p1/tasks/t1/comments');
    assert.equal(list.status, 200);
    assert.equal(((await list.json()) as { comments: { acknowledgements: unknown[] }[] }).comments[0]!.acknowledgements.length, 1);
    assert.equal((await call('GET', 'stranger', '/p1/tasks/t1/comments')).status, 404);
    // Supplying another user in the body cannot remove their acceptance.
    assert.equal((await call('DELETE', 'author')).status, 200);
    assert.equal(acknowledgements.length, 1);
    assert.equal((await call('DELETE', 'viewer')).status, 200);
    assert.equal(acknowledgements.length, 0);
    assert.equal(task.status, 'pending_approval');
    assert.equal(comment.body, 'Проверьте результат');
    assert.deepEqual(changes[0], ['viewer', 'author']);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  }
});

test('private inbox acknowledgement follows task visibility, not project membership', async () => {
  let writes = 0;
  const useCase = new AcknowledgeTaskComment({
    projects: { getById: async () => ({ id: 'inbox', isInbox: true, ownerId: 'owner' }) } as never,
    tasks: { getById: async () => ({ id: 'task', projectId: 'inbox', assignee: { userId: 'assignee' } }) } as never,
    members: { listApproverUserIdsForProject: async () => [] } as never,
    comments: { getById: async () => ({ taskId: 'task', ownerUserId: 'owner' }) } as never,
    acknowledgements: { set: async () => { writes++; }, listByComments: async () => [] },
  });
  await useCase.execute('inbox', 'task', 'comment', 'assignee', true);
  await assert.rejects(useCase.execute('inbox', 'task', 'comment', 'stranger', true), { name: 'ProjectNotFoundError' });
  assert.equal(writes, 1);
});
