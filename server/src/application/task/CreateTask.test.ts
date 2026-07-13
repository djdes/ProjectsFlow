import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CreateTask } from './CreateTask.js';

// Фокусный тест ветки delegateOrThrow. requireProjectAccess проходит через owner-membership
// фейка members.findForProject. Самоделегирование (delegateUserId === creator) РАЗРЕШЕНО:
// делегация accepted, но себе уведомление НЕ шлётся (по образцу DelegateExistingTask).

const OWNER_ID = 'u-owner';
const OTHER_ID = 'u-other';

function makeHarness(opts: { isInbox?: boolean } = {}) {
  const isInbox = opts.isInbox ?? true;
  const createdDelegations: { status?: string; delegatorUserId?: string; delegateUserId?: string }[] =
    [];
  const counters = { notify: 0 };
  const create = new CreateTask({
    projects: {
      getById: async () => ({ id: 'p1', isInbox, ownerId: OWNER_ID }),
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
      // notifyDelegated начинается с users.getById — считаем вход в notify по нему.
      getById: async (id: string) => {
        counters.notify += 1;
        return { id, email: 'x@x', displayName: 'X' };
      },
    } as never,
    notifications: { create: async () => {} } as never,
    email: { send: async () => {} } as never,
    idGen: () => 'id-1',
    appUrl: 'https://example.test',
  });
  return {
    create,
    createdDelegations,
    get notifyCalls() {
      return counters.notify;
    },
  };
}

const flushAsync = async (): Promise<void> => new Promise((r) => setImmediate(r));

test('создание задачи с делегатом: делегация сразу accepted', async () => {
  const h = makeHarness();
  const task = await h.create.execute({
    projectId: 'p1',
    ownerUserId: OWNER_ID,
    description: 'demo',
    status: 'todo',
    delegateUserId: OTHER_ID,
  });
  await flushAsync();
  assert.equal(h.createdDelegations[0]?.status, 'accepted');
  assert.equal(task.delegation?.status, 'accepted');
  assert.ok(h.notifyCalls > 0); // другому — уведомление уходит
});

test('самоделегирование в инбоксе: accepted, БЕЗ уведомления себе', async () => {
  const h = makeHarness();
  const task = await h.create.execute({
    projectId: 'p1',
    ownerUserId: OWNER_ID,
    description: 'demo',
    status: 'todo',
    delegateUserId: OWNER_ID, // == creator
  });
  await flushAsync();
  assert.equal(task.delegation?.status, 'accepted');
  assert.equal(h.createdDelegations[0]?.delegateUserId, OWNER_ID);
  assert.equal(h.createdDelegations[0]?.delegatorUserId, OWNER_ID);
  assert.equal(h.notifyCalls, 0); // себе не уведомляем
});

test('самоделегирование в именованном проекте: accepted, БЕЗ уведомления (задача «на мне» → «Для меня»)', async () => {
  const h = makeHarness({ isInbox: false });
  const task = await h.create.execute({
    projectId: 'p1',
    ownerUserId: OWNER_ID,
    description: 'demo',
    status: 'todo',
    delegateUserId: OWNER_ID,
  });
  await flushAsync();
  assert.equal(task.delegation?.status, 'accepted');
  assert.equal(h.createdDelegations[0]?.delegateUserId, OWNER_ID);
  assert.equal(h.notifyCalls, 0);
});
