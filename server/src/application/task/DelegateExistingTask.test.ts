import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DelegateExistingTask } from './DelegateExistingTask.js';
import { NotCreatorError } from '../../domain/task/errors.js';

// --- Минимальные in-memory фейки (tsx + node:test, без новых deps) ---
// Сценарии — inbox-проект: там и живёт самоделегирование (drag-перенос задачи в проект
// делает assignToProject + delegate(себе)). Именованные проекты идут через
// requireProjectAccess — его матрица покрыта своими тестами.

const OWNER_ID = 'u-owner';
const OTHER_ID = 'u-other';

type Created = {
  id: string;
  taskId: string;
  delegateUserId: string;
  delegatorUserId: string;
  status?: string;
};

type Harness = {
  delegate: DelegateExistingTask;
  createdInputs: Created[];
  notifyCalls: number;
};

function makeHarness(opts: { inboxOwnerId?: string } = {}): Harness {
  const createdInputs: Created[] = [];
  const counters = { notify: 0 };

  const delegate = new DelegateExistingTask({
    projects: {
      getById: async () => ({ id: 'p1', isInbox: true, ownerId: opts.inboxOwnerId ?? OWNER_ID }),
    } as never,
    members: {
      listSharedUsers: async () => [{ id: OTHER_ID }],
      findForProject: async () => null,
    } as never,
    tasks: {
      getById: async () => ({ id: 't1', projectId: 'p1', description: 'demo' }),
    } as never,
    delegations: {
      findActiveForTask: async () => null,
      create: async (input: Created) => {
        createdInputs.push(input);
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
    delegate,
    createdInputs,
    get notifyCalls() {
      return counters.notify;
    },
  };
}

const flushAsync = async (): Promise<void> => new Promise((r) => setImmediate(r));

test('самоделегирование в своём инбоксе: создаётся сразу accepted, без уведомлений', async () => {
  const h = makeHarness();
  const result = await h.delegate.execute('t1', OWNER_ID, OWNER_ID);
  await flushAsync();
  assert.equal(result.status, 'accepted');
  assert.equal(h.createdInputs[0]?.status, 'accepted');
  assert.equal(h.notifyCalls, 0);
});

test('обычное делегирование другому: pending + уведомление уходит', async () => {
  const h = makeHarness();
  const result = await h.delegate.execute('t1', OTHER_ID, OWNER_ID);
  await flushAsync();
  assert.equal(result.status, 'pending');
  assert.equal(h.createdInputs[0]?.status, undefined);
  assert.ok(h.notifyCalls > 0);
});

test('самоделегирование в ЧУЖОМ инбоксе запрещено (NotCreatorError)', async () => {
  const h = makeHarness({ inboxOwnerId: 'someone-else' });
  await assert.rejects(() => h.delegate.execute('t1', OWNER_ID, OWNER_ID), NotCreatorError);
  assert.equal(h.createdInputs.length, 0);
});
