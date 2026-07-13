import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RelinquishTaskDelegation } from './RelinquishTaskDelegation.js';
import {
  DelegationWrongStateError,
  NotDelegateError,
} from '../../domain/task/errors.js';

// Минимальные in-memory фейки (tsx + node:test, без новых deps).

const DELEGATE_ID = 'u-del';
const CREATOR_ID = 'u-creator';

type Harness = {
  relinquish: RelinquishTaskDelegation;
  setStatusCalls: { id: string; status: string }[];
  notifications: { userId: string; payload: Record<string, unknown> }[];
  emails: { to: string; subject: string }[];
};

function makeHarness(status: string): Harness {
  const setStatusCalls: Harness['setStatusCalls'] = [];
  const notifications: Harness['notifications'] = [];
  const emails: Harness['emails'] = [];
  const d = (s: string) => ({
    id: 'd1',
    taskId: 't1',
    delegateUserId: DELEGATE_ID,
    delegateDisplayName: 'Делегат',
    creatorUserId: CREATOR_ID,
    creatorDisplayName: 'Создатель',
    status: s,
    createdAt: new Date(0),
    respondedAt: null,
    revertToUserId: null,
  });
  const relinquish = new RelinquishTaskDelegation({
    delegations: {
      getById: async () => d(status),
      setStatus: async (id: string, s: string) => {
        setStatusCalls.push({ id, status: s });
        return d(s);
      },
    } as never,
    tasks: {
      getById: async () => ({ id: 't1', projectId: 'p1', description: 'demo task' }),
    } as never,
    users: {
      getById: async (id: string) => ({ id, email: 'creator@x', displayName: 'Создатель' }),
    } as never,
    notifications: {
      create: async (n: { userId: string; payload: Record<string, unknown> }) => {
        notifications.push({ userId: n.userId, payload: n.payload });
      },
    } as never,
    email: {
      send: async (m: { to: string; subject: string }) => {
        emails.push({ to: m.to, subject: m.subject });
      },
    } as never,
    idGen: () => 'n-1',
    appUrl: 'https://example.test',
  });
  return { relinquish, setStatusCalls, notifications, emails };
}

const flushAsync = async (): Promise<void> => new Promise((r) => setImmediate(r));

test('делегат складывает accepted → withdrawn + уведомление создателю + email', async () => {
  const h = makeHarness('accepted');
  await h.relinquish.execute('d1', DELEGATE_ID);
  await flushAsync();
  assert.deepEqual(h.setStatusCalls, [{ id: 'd1', status: 'withdrawn' }]);
  assert.equal(h.notifications.length, 1);
  assert.equal(h.notifications[0]!.userId, CREATOR_ID);
  assert.equal(h.notifications[0]!.payload['type'], 'task_delegation_resolved');
  assert.equal(h.notifications[0]!.payload['resolution'], 'declined');
  assert.equal(h.notifications[0]!.payload['actorUserId'], DELEGATE_ID);
  assert.equal(h.notifications[0]!.payload['taskExcerpt'], 'demo task');
  assert.equal(h.emails.length, 1);
  assert.equal(h.emails[0]!.to, 'creator@x');
  assert.match(h.emails[0]!.subject, /снял/);
});

test('не-делегат получает NotDelegateError, без уведомлений', async () => {
  const h = makeHarness('accepted');
  await assert.rejects(() => h.relinquish.execute('d1', 'someone-else'), NotDelegateError);
  await flushAsync();
  assert.equal(h.setStatusCalls.length, 0);
  assert.equal(h.notifications.length, 0);
});

test('терминальный статус → DelegationWrongStateError, без уведомлений', async () => {
  const h = makeHarness('declined');
  await assert.rejects(() => h.relinquish.execute('d1', DELEGATE_ID), DelegationWrongStateError);
  await flushAsync();
  assert.equal(h.setStatusCalls.length, 0);
  assert.equal(h.notifications.length, 0);
});
