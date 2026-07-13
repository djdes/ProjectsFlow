import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CreateTask } from './CreateTask.js';

// Фокусный тест ветки delegateOrThrow (inbox-путь). requireProjectAccess проходит
// через owner-membership фейка members.findForProject.

const OWNER_ID = 'u-owner';
const OTHER_ID = 'u-other';

function makeHarness() {
  const createdDelegations: { status?: string }[] = [];
  const create = new CreateTask({
    projects: {
      getById: async () => ({ id: 'p1', isInbox: true, ownerId: OWNER_ID }),
    } as never,
    members: {
      findForProject: async () => ({
        projectId: 'p1',
        userId: OWNER_ID,
        role: 'owner',
        joinedAt: new Date(0),
      }),
      listSharedUsers: async () => [{ id: OTHER_ID }],
    } as never,
    tasks: {
      getById: async () => null,
      getPositionBounds: async () => null,
      create: async (input: unknown) => ({ ...(input as object), delegation: null }),
    } as never,
    delegations: {
      findActiveForTask: async () => null,
      create: async (input: { status?: string; delegatorUserId: string }) => {
        createdDelegations.push(input);
        return {
          ...input,
          delegateDisplayName: '',
          creatorUserId: input.delegatorUserId,
          creatorDisplayName: '',
          status: input.status ?? 'pending',
          createdAt: new Date(0),
          respondedAt: null,
          revertToUserId: null,
        };
      },
    } as never,
    users: {
      getById: async (id: string) => ({ id, email: 'x@x', displayName: 'X' }),
    } as never,
    notifications: { create: async () => {} } as never,
    email: { send: async () => {} } as never,
    idGen: () => 'id-1',
    appUrl: 'https://example.test',
  });
  return { create, createdDelegations };
}

test('создание задачи с делегатом: делегация сразу accepted', async () => {
  const h = makeHarness();
  const task = await h.create.execute({
    projectId: 'p1',
    ownerUserId: OWNER_ID,
    description: 'demo',
    status: 'todo',
    delegateUserId: OTHER_ID,
  });
  assert.equal(h.createdDelegations[0]?.status, 'accepted');
  assert.equal(task.delegation?.status, 'accepted');
});
