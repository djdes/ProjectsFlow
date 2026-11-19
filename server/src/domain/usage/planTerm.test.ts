import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PLAN_TERM_MAX, applyPlanTerm, isValidPlanTerm } from './planTerm.js';

const now = new Date('2026-11-04T00:00:00Z');
const started = new Date('2026-01-01T00:00:00Z');
const at = (iso: string) => new Date(iso);

test('extend adds days to a running term of the same plan and keeps its start', () => {
  const next = applyPlanTerm({ plan: 'prime', startedAt: started, expiresAt: at('2026-12-01T00:00:00Z') }, 'prime', { kind: 'extend', days: 30 }, now);
  assert.deepEqual(next, { plan: 'prime', startedAt: started, expiresAt: at('2026-12-31T00:00:00Z') });
});

test('extend counts from now for another plan, a lapsed term or free', () => {
  const plus7 = at('2026-11-11T00:00:00Z');
  assert.deepEqual(applyPlanTerm({ plan: 'prime', startedAt: started, expiresAt: at('2026-12-01T00:00:00Z') }, 'vip', { kind: 'extend', days: 7 }, now),
    { plan: 'vip', startedAt: now, expiresAt: plus7 });
  assert.deepEqual(applyPlanTerm({ plan: 'prime', startedAt: started, expiresAt: at('2026-10-01T00:00:00Z') }, 'prime', { kind: 'extend', days: 7 }, now),
    { plan: 'prime', startedAt: now, expiresAt: plus7 });
  assert.deepEqual(applyPlanTerm({ plan: 'free', startedAt: null, expiresAt: null }, 'prime', { kind: 'extend', days: 7 }, now),
    { plan: 'prime', startedAt: now, expiresAt: plus7 });
});

test('a running unlimited grant stays unlimited on extend; until and unlimited set the end directly', () => {
  const unlimited = { plan: 'vip' as const, startedAt: started, expiresAt: null };
  assert.deepEqual(applyPlanTerm(unlimited, 'vip', { kind: 'extend', days: 30 }, now), unlimited);
  assert.deepEqual(applyPlanTerm(unlimited, 'vip', { kind: 'until', date: at('2027-01-01T00:00:00Z') }, now),
    { plan: 'vip', startedAt: started, expiresAt: at('2027-01-01T00:00:00Z') });
  assert.deepEqual(applyPlanTerm({ plan: 'free', startedAt: null, expiresAt: null }, 'prime', { kind: 'unlimited' }, now),
    { plan: 'prime', startedAt: now, expiresAt: null });
});

test('terms are bounded: 1–3650 days, a future date before 2038', () => {
  assert.equal(isValidPlanTerm({ kind: 'extend', days: 0 }, now), false);
  assert.equal(isValidPlanTerm({ kind: 'extend', days: 1.5 }, now), false);
  assert.equal(isValidPlanTerm({ kind: 'extend', days: 3650 }, now), true);
  assert.equal(isValidPlanTerm({ kind: 'until', date: at('2026-11-01T00:00:00Z') }, now), false);
  assert.equal(isValidPlanTerm({ kind: 'until', date: at('2040-01-01T00:00:00Z') }, now), false);
  assert.equal(isValidPlanTerm({ kind: 'until', date: new Date(Number.NaN) }, now), false);
  const far = applyPlanTerm({ plan: 'prime', startedAt: started, expiresAt: at('2037-12-01T00:00:00Z') }, 'prime', { kind: 'extend', days: 3650 }, now);
  assert.equal(far.expiresAt!.getTime(), PLAN_TERM_MAX.getTime());
});
