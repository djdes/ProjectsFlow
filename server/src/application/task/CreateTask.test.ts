import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CreateTaskInput } from './TaskRepository.js';
import { CreateTask } from './CreateTask.js';

const OWNER_ID = 'u-owner';
const OTHER_ID = 'u-other';

function makeHarness(
  opts: { isInbox?: boolean; strangers?: readonly string[]; now?: Date } = {},
) {
  const isInbox = opts.isInbox ?? true;
  // Users with no membership in the target project (findForProject → null).
  const strangers = new Set(opts.strangers ?? []);
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
      findForProject: async (projectId: string, userId: string) =>
        strangers.has(userId)
          ? null
          : {
              projectId,
              userId,
              role: userId === OWNER_ID ? 'owner' : 'viewer',
              joinedAt: new Date(0),
            },
      // Оба тестовых юзера — коллеги по общему проекту (отношение симметрично).
      listSharedUsers: async (userId: string) => [
        { id: userId === OWNER_ID ? OTHER_ID : OWNER_ID },
      ],
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
    now: () => opts.now ?? new Date('2026-07-20T09:00:00Z'),
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

// --- Дефолтный срок «сегодня» ---

test('a task created without a deadline gets today', async () => {
  const h = makeHarness({ now: new Date('2026-07-20T09:00:00Z') });
  await h.create.execute({
    projectId: 'p1',
    ownerUserId: OWNER_ID,
    description: 'demo',
    status: 'todo',
  });

  assert.equal(h.created[0]!.deadline, '2026-07-20');
});

test('an explicit deadline is kept as is', async () => {
  const h = makeHarness();
  await h.create.execute({
    projectId: 'p1',
    ownerUserId: OWNER_ID,
    description: 'demo',
    status: 'todo',
    deadline: '2026-08-15',
  });

  assert.equal(h.created[0]!.deadline, '2026-08-15');
});

test('an explicit null deadline still becomes today (создание — не «снятие срока»)', async () => {
  const h = makeHarness({ now: new Date('2026-07-20T09:00:00Z') });
  await h.create.execute({
    projectId: 'p1',
    ownerUserId: OWNER_ID,
    description: 'demo',
    status: 'todo',
    deadline: null,
  });

  assert.equal(h.created[0]!.deadline, '2026-07-20');
});

test('preserveEmptyDeadline keeps an empty deadline empty (копирование доски)', async () => {
  const h = makeHarness();
  await h.create.execute({
    projectId: 'p1',
    ownerUserId: OWNER_ID,
    description: 'demo',
    status: 'todo',
    deadline: null,
    preserveEmptyDeadline: true,
  });

  assert.equal(h.created[0]!.deadline, null);
});

test('late Moscow evening still resolves to the Moscow calendar day, not the UTC one', async () => {
  // 22:30 МСК 20 июля = 19:30 UTC того же дня; наивный UTC-срез дал бы 2026-07-20 верно,
  // поэтому берём противоположный край: 01:30 МСК 21 июля = 22:30 UTC 20 июля.
  const h = makeHarness({ now: new Date('2026-07-20T22:30:00Z') });
  await h.create.execute({
    projectId: 'p1',
    ownerUserId: OWNER_ID,
    description: 'demo',
    status: 'todo',
  });

  assert.equal(h.created[0]!.deadline, '2026-07-21');
});

// --- Delegation into a colleague's inbox (allowInboxDelegation) ---

test('a colleague may create a task in the inbox owner`s inbox when it is assigned to him', async () => {
  const h = makeHarness({ strangers: [OTHER_ID] });
  const task = await h.create.execute({
    projectId: 'p1',
    ownerUserId: OTHER_ID, // не участник inbox-проекта OWNER_ID
    description: 'demo',
    status: 'todo',
    assigneeUserId: OWNER_ID,
    allowInboxDelegation: true,
  });
  await flushAsync();

  assert.equal(task.assignee.userId, OWNER_ID);
  assert.equal(h.created[0]!.projectId, 'p1');
  // Авторство остаётся за отправителем.
  assert.equal(h.created[0]!.createdBy, OTHER_ID);
});

test('inbox delegation does not let a stranger assign the task to a third party', async () => {
  const h = makeHarness({ strangers: [OTHER_ID] });
  await assert.rejects(
    h.create.execute({
      projectId: 'p1',
      ownerUserId: OTHER_ID,
      description: 'demo',
      status: 'todo',
      assigneeUserId: 'u-third',
      allowInboxDelegation: true,
    }),
    /ProjectNotFound|не найден|not found/i,
  );
  assert.equal(h.created.length, 0);
});

test('inbox delegation never applies to a regular project', async () => {
  const h = makeHarness({ isInbox: false, strangers: [OTHER_ID] });
  await assert.rejects(
    h.create.execute({
      projectId: 'p1',
      ownerUserId: OTHER_ID,
      description: 'demo',
      status: 'todo',
      assigneeUserId: OWNER_ID,
      allowInboxDelegation: true,
    }),
    /ProjectNotFound|не найден|not found/i,
  );
  assert.equal(h.created.length, 0);
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
