import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CreateTaskComment } from './CreateTaskComment.js';
import { TaskCommentBodyEmptyError } from '../../domain/task/errors.js';

function makeUseCase(): { useCase: CreateTaskComment; created: { body: string }[] } {
  const created: { body: string }[] = [];
  const project = { id: 'p1', name: 'Проект', isInbox: false, ownerId: 'owner', workspaceId: 'w1' };
  const task = { id: 't1', projectId: 'p1', description: 'Задача', status: 'todo', assignee: { userId: 'me' }, createdBy: 'me' };
  const useCase = new CreateTaskComment({
    approval: {} as never,
    projects: { getById: async () => project } as never,
    members: {
      findForProject: async () => ({ projectId: 'p1', userId: 'me', role: 'editor', joinedAt: new Date() }),
      listByProject: async () => [],
    } as never,
    tasks: { getById: async () => task } as never,
    comments: {
      create: async (input: { id: string; body: string }) => {
        created.push({ body: input.body });
        return { ...input, ownerUserId: 'me', taskId: 't1', actorKind: 'user', agentName: null, notifyMode: 'all',
          replyToCommentId: null, quotedText: null, createdAt: new Date(), updatedAt: new Date() };
      },
    } as never,
    notifications: { create: async () => undefined } as never,
    idGen: () => 'c1',
  });
  return { useCase, created };
}

const command = { projectId: 'p1', ownerUserId: 'me', taskId: 't1' };

test('comment without text and attachments is rejected', async () => {
  const { useCase, created } = makeUseCase();
  await assert.rejects(useCase.execute({ ...command, body: '   ' }), TaskCommentBodyEmptyError);
  assert.equal(created.length, 0);
});

test('comment with attachments only is created with an empty body', async () => {
  const { useCase, created } = makeUseCase();
  const comment = await useCase.execute({ ...command, body: ' ', attachmentCount: 1 });
  assert.equal(comment.body, '');
  assert.deepEqual(created, [{ body: '' }]);
});

test('comment with text keeps working without attachments', async () => {
  const { useCase, created } = makeUseCase();
  await useCase.execute({ ...command, body: ' привет ' });
  assert.deepEqual(created, [{ body: 'привет' }]);
});
