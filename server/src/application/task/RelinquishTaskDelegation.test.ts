import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RelinquishTaskDelegation } from './RelinquishTaskDelegation.js';
import {
  DelegationWrongStateError,
  NotDelegateError,
} from '../../domain/task/errors.js';

// Минимальные фейки по образцу AcceptTaskDelegation.test.ts.

const DELEGATE_ID = 'u-del';

function makeHarness(status: string): {
  relinquish: RelinquishTaskDelegation;
  setStatusCalls: { id: string; status: string }[];
} {
  const setStatusCalls: { id: string; status: string }[] = [];
  const relinquish = new RelinquishTaskDelegation({
    delegations: {
      getById: async () => ({
        id: 'd1',
        taskId: 't1',
        delegateUserId: DELEGATE_ID,
        creatorUserId: 'u-creator',
        status,
      }),
      setStatus: async (id: string, s: string) => {
        setStatusCalls.push({ id, status: s });
        return { id, status: s };
      },
    } as never,
  });
  return { relinquish, setStatusCalls };
}

test('делегат складывает с себя accepted-делегацию → withdrawn', async () => {
  const h = makeHarness('accepted');
  await h.relinquish.execute('d1', DELEGATE_ID);
  assert.deepEqual(h.setStatusCalls, [{ id: 'd1', status: 'withdrawn' }]);
});

test('не-делегат получает NotDelegateError', async () => {
  const h = makeHarness('accepted');
  await assert.rejects(() => h.relinquish.execute('d1', 'someone-else'), NotDelegateError);
  assert.equal(h.setStatusCalls.length, 0);
});

test('терминальный статус → DelegationWrongStateError', async () => {
  const h = makeHarness('declined');
  await assert.rejects(() => h.relinquish.execute('d1', DELEGATE_ID), DelegationWrongStateError);
  assert.equal(h.setStatusCalls.length, 0);
});
