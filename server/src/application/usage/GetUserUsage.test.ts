import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GetUserUsage } from './GetUserUsage.js';
import { CheckBudget, assertBudgetAllowed, assertDispatcherAllowed } from './CheckBudget.js';
import { CheckDispatchAllowed } from './CheckDispatchAllowed.js';

function setup(unlimitedUserIds?: ReadonlySet<string>, plan: 'prime' | 'free' = 'prime') {
  const usage = new GetUserUsage({
    now: () => new Date('2026-10-23T11:00:00Z'),
    unlimitedUserIds,
    users: {
      getById: async (id: string) => ({ id, isAdmin: false }),
      getSubscription: async () => ({ plan, startedAt: null, expiresAt: null }),
      getPrimeTrialUsedAt: async () => null,
    } as never,
    ledger: {
      sumSince: async () => 12.65,
      earliestSince: async () => new Date('2026-10-23T10:00:00Z'),
    } as never,
  });
  return { usage, budget: new CheckBudget({ getUserUsage: usage }) };
}

test('personal unlimited windows preserve spending and role, allow AI and worker starts', async () => {
  const { usage, budget } = setup(new Set(['owner']));
  const result = await usage.execute('owner');
  assert.equal(result.isAdmin, false);
  assert.equal(result.plan, 'prime');
  assert.equal(result.isBlocked, false);
  assert.equal(result.blockedWindow, null);
  for (const window of [result.fiveHour, result.sevenDay]) {
    assert.equal(window.spentUsd, 12.65);
    assert.equal(window.capUsd, null);
    assert.equal(window.remainingUsd, null);
    assert.equal(window.resetsAt, null);
    assert.equal(window.isOver, false);
  }
  await assertBudgetAllowed(budget, 'owner');
  await assertDispatcherAllowed(budget, 'owner');
  const dispatch = new CheckDispatchAllowed({
    checkBudget: budget,
    tasks: { getById: async () => ({ createdBy: 'owner' }) } as never,
    legacyAttribution: { findLegacyCreatorForTask: async () => null } as never,
  });
  assert.equal((await dispatch.execute('task')).allowed, true);
});

test('unlimited exception is exact and does not affect other accounts or change plan requirements', async () => {
  const { usage, budget } = setup(new Set(['owner']));
  for (const id of ['other', 'owner-suffix', '']) {
    const result = await usage.execute(id);
    assert.equal(result.isBlocked, true);
    assert.equal(result.fiveHour.capUsd, 5);
    assert.equal(result.sevenDay.capUsd, 12.5);
    await assert.rejects(() => assertBudgetAllowed(budget, id));
    await assert.rejects(() => assertDispatcherAllowed(budget, id));
  }
  assert.equal((await setup().usage.execute('owner')).isBlocked, true);
  const free = setup(new Set(['owner']), 'free');
  await assert.rejects(() => assertDispatcherAllowed(free.budget, 'owner'));
});
