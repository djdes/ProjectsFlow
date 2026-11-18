import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentActivityTracker } from './AgentActivityTracker.js';

test('AgentActivityTracker: помнит последнее обращение агента', () => {
  const tracker = new AgentActivityTracker(new Date('2026-11-18T10:00:00Z'));
  assert.equal(tracker.lastSeen('u1'), null);
  tracker.touch('u1', new Date('2026-11-18T10:01:00Z'));
  tracker.touch('u1', new Date('2026-11-18T10:02:00Z'));
  assert.equal(tracker.lastSeen('u1')?.toISOString(), '2026-11-18T10:02:00.000Z');
  assert.equal(tracker.trackedSince.toISOString(), '2026-11-18T10:00:00.000Z');
});
