import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CreateTaskInput } from './TaskRepository.js';
import { CreateTask } from './CreateTask.js';

const OWNER_ID = 'u-owner';
const OTHER_ID = 'u-other';

function makeHarness(opts: { isInbox?: boolean } = {}) {
  const isInbox = opts.isInbox ?? true;
  const created: CreateTaskInput[] = [];
  const counters = { notifications: 0, emails: 0 };
  const create = new CreateTask({
    projects: {
      getById: async () => ({
        id: 'p1',
        name: isInbox ? 'Входящие' : 'Проект',
        isInbox,
        ownerId: OWNER_ID,
      }),
    } as never,
    members: {
      findForProject: async (projectId: string, userId: string) => ({
        projectId,
        userId,
        role: userId === OWNER_ID ? 'owner' : 'viewer',
        joinedAt: new Date(0),
      }),
      listSharedUsers: async () => [{ id: OTHER_ID }],
    } as never,
    tasks: {
      getById: async () => null,
      getPositionBounds: async () => null,
      create: async (input: CreateTaskInput) => {
        created.push(input);
        return {
          ...input,
          assignee: {
            userId: input.assigneeUserId,
            displayName: input.assigneeUserId === OTHER_ID ? 'Другой' : 'Владелец',
            avatarUrl: null,
          },
        };
      },
    } as never,
    users: {
      getById: async (id: string) => ({
        id,
        email: `${id}@example.test`,
        displayName: id === OTHER_ID ? 'Другой' : 'Владелец',
      }),
    } as never,
    notifications: {
      create: async () => {
        counters.notifications += 1;
      },
    } as never,
    email: {
      send: async () => {
        counters.emails += 1;
      },
    } as never,
    idGen: () => 'id-1',
    appUrl: 'https://example.test',
  });
  return { create, created, counters };
}

const flushAsync = async (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

test('without an explicit assignee, the creator becomes the only assignee', async () => {
  const h = makeHarness();
  const task = await h.create.execute({
    projectId: 'p1',
    ownerUserId: OWNER_ID,
    description: 'demo',
    status: 'todo',
  });
  await flushAsync();

  assert.equal(h.created[0]!.assigneeUserId, OWNER_ID);
  assert.equal(task.assignee.userId, OWNER_ID);
  assert.equal(h.counters.notifications, 0);
  assert.equal(h.counters.emails, 0);
});

test('an Inbox task can be created for a shared user and notifies the assignee', async () => {
  const h = makeHarness();
  const task = await h.create.execute({
    projectId: 'p1',
    ownerUserId: OWNER_ID,
    description: 'demo',
    status: 'todo',
    assigneeUserId: OTHER_ID,
  });
  await flushAsync();

  assert.equal(task.assignee.userId, OTHER_ID);
  assert.equal(h.counters.notifications, 1);
  assert.equal(h.counters.emails, 1);
});

test('a viewer can be the assignee of a named-project task', async () => {
  const h = makeHarness({ isInbox: false });
  const task = await h.create.execute({
    projectId: 'p1',
    ownerUserId: OWNER_ID,
    description: 'demo',
    status: 'todo',
    assigneeUserId: OTHER_ID,
  });

  assert.equal(task.assignee.userId, OTHER_ID);
});
