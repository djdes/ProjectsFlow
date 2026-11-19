import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LastSeenTracker } from './LastSeenTracker.js';

test('last seen is written at most once per interval per user, with the DB-side threshold', async () => {
  const writes: [string, string, string][] = [];
  const tracker = new LastSeenTracker({
    recordLogin: async () => {},
    touchLastSeen: async (id, at, olderThan) => { writes.push([id, at.toISOString(), olderThan.toISOString()]); },
  }, 60_000);
  const t0 = new Date('2026-11-04T10:00:00Z');
  tracker.touch('a', t0);
  tracker.touch('a', new Date(t0.getTime() + 30_000));
  tracker.touch('b', t0);
  tracker.touch('a', new Date(t0.getTime() + 61_000));
  assert.deepEqual(writes, [
    ['a', '2026-11-04T10:00:00.000Z', '2026-11-04T09:59:00.000Z'],
    ['b', '2026-11-04T10:00:00.000Z', '2026-11-04T09:59:00.000Z'],
    ['a', '2026-11-04T10:01:01.000Z', '2026-11-04T10:00:01.000Z'],
  ]);
});

test('a failing write is logged, not thrown into the request', async () => {
  const tracker = new LastSeenTracker({ recordLogin: async () => {}, touchLastSeen: async () => { throw new Error('db down'); } });
  const original = console.error;
  const logged: unknown[] = [];
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    assert.doesNotThrow(() => tracker.touch('a', new Date()));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(logged.length, 1);
  } finally { console.error = original; }
});
