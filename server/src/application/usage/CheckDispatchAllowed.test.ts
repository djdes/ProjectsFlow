import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CheckDispatchAllowed } from './CheckDispatchAllowed.js';
import type { UsageSummary } from '../../domain/usage/UsageSummary.js';

// Минимальный usage-summary для теста гейта. Заполняем только поля, которые читает гейт.
function summary(p: Partial<UsageSummary>): UsageSummary {
  return {
    plan: 'prime',
    isAdmin: false,
    isBlocked: false,
    blockedWindow: null,
    // остальные поля не читаются гейтом — заглушки.
    subscription: { plan: 'prime', startedAt: null, expiresAt: null },
    fiveHour: { label: '5h', spentUsd: 0, capUsd: 5, remainingUsd: 5, isOver: false, resetsAt: null },
    sevenDay: { label: '7d', spentUsd: 0, capUsd: 12.5, remainingUsd: 12.5, isOver: false, resetsAt: null },
    primeTrialAvailable: false,
    ...p,
  } as UsageSummary;
}

// Фабрика гейта: task.createdBy = billed user; checkBudget отдаёт заданный summary.
function build(createdBy: string | null, s: UsageSummary | null) {
  return new CheckDispatchAllowed({
    tasks: { getById: async () => (createdBy ? ({ createdBy } as never) : null) } as never,
    taskDelegations: { findActiveForTask: async () => null } as never,
    checkBudget: s
      ? ({ execute: async () => ({ allowed: !s.isBlocked, summary: s }) } as never)
      : undefined,
  });
}

describe('CheckDispatchAllowed — гейт воркера (нет бесплатного расхода подписки)', () => {
  it('free-инициатор → заблокирован (plan_required)', async () => {
    const r = await build('u1', summary({ plan: 'free' })).execute('t1');
    assert.equal(r.allowed, false);
    assert.equal(r.reason, 'plan_required');
    assert.equal(r.billedUserId, 'u1');
  });

  it('исчерпал окно → заблокирован (budget_exceeded)', async () => {
    const r = await build('u2', summary({ plan: 'prime', isBlocked: true, blockedWindow: '5h' })).execute('t2');
    assert.equal(r.allowed, false);
    assert.equal(r.reason, 'budget_exceeded');
  });

  it('prime в пределах лимита → разрешён', async () => {
    const r = await build('u3', summary({ plan: 'prime' })).execute('t3');
    assert.equal(r.allowed, true);
    assert.equal(r.reason, 'ok');
  });

  it('админ → разрешён всегда (даже на free-плане)', async () => {
    const r = await build('admin', summary({ plan: 'free', isAdmin: true })).execute('t4');
    assert.equal(r.allowed, true);
    assert.equal(r.reason, 'ok');
  });

  it('нет инициатора (нет createdBy/делегации) → fallback allow', async () => {
    const r = await build(null, summary({ plan: 'free' })).execute('t5');
    assert.equal(r.allowed, true);
    assert.equal(r.billedUserId, null);
  });
});
