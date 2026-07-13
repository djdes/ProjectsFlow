import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReassignTaskDelegation } from './ReassignTaskDelegation.js';

// Минимальные in-memory фейки по образцу DelegateExistingTask.test.ts.
// Сценарий — inbox-проект: владелец переназначает с одного делегата на другого.

const OWNER_ID = 'u-owner';
const OLD_DELEGATE = 'u-old';
const NEW_DELEGATE = 'u-new';

type Created = {
  id: string;
  taskId: string;
  delegateUserId: string;
  delegatorUserId: string;
  status?: string;
};

function makeHarness() {
  const createdInputs: Created[] = [];
  const statusCalls: { id: string; status: string }[] = [];
  const counters = { notify: 0 };

  const reassign = new ReassignTaskDelegation({
    projects: {
      getById: async () => ({ id: 'p1', isInbox: true, ownerId: OWNER_ID }),
    } as never,
    members: {
      listSharedUsers: async () => [{ id: OLD_DELEGATE }, { id: NEW_DELEGATE }],
      findForProject: async () => null,
    } as never,
    tasks: {
      getById: async () => ({ id: 't1', projectId: 'p1', description: 'demo' }),
    } as never,
    delegations: {
      findActiveForTask: async () =>
        ({ id: 'd-old', taskId: 't1', delegateUserId: OLD_DELEGATE, status: 'accepted' }) as never,
      setStatus: async (id: string, s: string) => {
        statusCalls.push({ id, status: s });
        return null;
      },
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
    idGen: () => 'id-new',
    appUrl: 'https://example.test',
  });

  return {
    reassign,
    createdInputs,
    statusCalls,
    get notifyCalls() {
      return counters.notify;
    },
  };
}

const flushAsync = async (): Promise<void> => new Promise((r) => setImmediate(r));

test('переназначение: старая архивируется, новая — сразу accepted, уведомление уходит', async () => {
  const h = makeHarness();
  const result = await h.reassign.execute('t1', NEW_DELEGATE, OWNER_ID);
  await flushAsync();
  assert.deepEqual(h.statusCalls, [{ id: 'd-old', status: 'archived' }]);
  assert.equal(h.createdInputs[0]?.status, 'accepted');
  assert.equal(result.status, 'accepted');
  assert.ok(h.notifyCalls > 0);
});

test('дроп на текущего делегата — no-op (возвращается активная, ничего не создаётся)', async () => {
  const h = makeHarness();
  const result = await h.reassign.execute('t1', OLD_DELEGATE, OWNER_ID);
  assert.equal(result.id, 'd-old');
  assert.equal(h.createdInputs.length, 0);
  assert.equal(h.statusCalls.length, 0);
});
