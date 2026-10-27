import assert from 'node:assert/strict';
import test from 'node:test';
import type { UsageSummary } from '@/domain/usage/Usage';
import { isWorkerLockedByPlan } from './workerHandoff';

function usage(plan: UsageSummary['plan'], isAdmin = false): UsageSummary {
  const window = {
    spentUsd: 0,
    capUsd: null,
    remainingUsd: null,
    isOver: false,
    resetsAt: null,
  };
  return {
    plan,
    subscription: { plan, startedAt: null, expiresAt: null },
    fiveHour: { ...window, label: '5h' },
    sevenDay: { ...window, label: '7d' },
    isBlocked: false,
    blockedWindow: null,
    rubPerUsd: 100,
    primeTrialAvailable: false,
    isAdmin,
  };
}

test('worker handoff stays available while usage loads and on paid plans', () => {
  assert.equal(isWorkerLockedByPlan(null), false);
  assert.equal(isWorkerLockedByPlan(usage('prime')), false);
  assert.equal(isWorkerLockedByPlan(usage('vip')), false);
});

test('free plan locks worker handoff except for administrators', () => {
  assert.equal(isWorkerLockedByPlan(usage('free')), true);
  assert.equal(isWorkerLockedByPlan(usage('free', true)), false);
});
