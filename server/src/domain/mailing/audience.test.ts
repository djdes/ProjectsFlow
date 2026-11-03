import assert from 'node:assert/strict';
import test from 'node:test';
import { effectiveMailingPlan, parseMailingAudience, selectMailingRecipients } from './audience.js';

const user = (userId: string, email: string) => ({ userId, email, displayName: userId, workspaceName: null });

test('selection excludes unsubscribed users, invalid and duplicate addresses; keeps order', () => {
  const { recipients, reach } = selectMailingRecipients([
    user('a', 'a@example.com'),
    user('b', 'b@example.com'),
    user('c', 'not-an-email'),
    user('d', ' A@Example.com '),
    user('a', 'a@example.com'),
    user('e', 'e@example.com'),
  ], new Set(['b']));
  assert.deepEqual(recipients.map((r) => r.userId), ['a', 'e']);
  assert.deepEqual(reach, { eligible: 2, unsubscribed: 1, invalid: 2 });
});

test('audience parsing accepts only known shapes', () => {
  assert.deepEqual(parseMailingAudience({ kind: 'all' }), { kind: 'all' });
  assert.deepEqual(parseMailingAudience({ kind: 'workspace', workspaceId: 'ws-1' }), { kind: 'workspace', workspaceId: 'ws-1' });
  assert.deepEqual(parseMailingAudience({ kind: 'plan', plans: ['vip', 'free'] }), { kind: 'plan', plans: ['free', 'vip'] });
  assert.equal(parseMailingAudience({ kind: 'plan', plans: [] }), null);
  assert.equal(parseMailingAudience({ kind: 'plan', plans: ['gold'] }), null);
  assert.equal(parseMailingAudience({ kind: 'workspace', workspaceId: "x' OR 1=1" }), null);
  assert.equal(parseMailingAudience({ kind: 'everyone' }), null);
  assert.equal(parseMailingAudience(null), null);
});

test('effective plan: lapsed subscription reads as free, no expiry is unlimited', () => {
  const now = new Date('2026-11-03T00:00:00Z');
  assert.equal(effectiveMailingPlan('prime', new Date('2026-12-01T00:00:00Z'), now), 'prime');
  assert.equal(effectiveMailingPlan('prime', new Date('2026-10-01T00:00:00Z'), now), 'free');
  assert.equal(effectiveMailingPlan('vip', null, now), 'vip');
  assert.equal(effectiveMailingPlan('free', null, now), 'free');
});
