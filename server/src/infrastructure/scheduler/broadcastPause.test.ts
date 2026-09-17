import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultDigestSettings } from '../../domain/digest/DigestSettings.js';
import { DailyDigestScheduler } from './DailyDigestScheduler.js';
import { resolvePausedUntil, scheduledBroadcastsPaused } from './broadcastPause.js';

test('broadcasts are paused up to the last MSK minute before the resume date', () => {
  // 2026-09-30 23:59 MSK
  assert.equal(scheduledBroadcastsPaused(new Date('2026-09-30T20:59:00.000Z'), '2026-10-01'), true);
});

test('broadcasts resume at MSK midnight of the resume date and stay on afterwards', () => {
  // 2026-10-01 00:00 MSK (ещё 30 сентября по UTC)
  assert.equal(scheduledBroadcastsPaused(new Date('2026-09-30T21:00:00.000Z'), '2026-10-01'), false);
  assert.equal(scheduledBroadcastsPaused(new Date('2026-11-15T09:00:00.000Z'), '2026-10-01'), false);
});

test('pause date resolves from env: default, override, off', () => {
  assert.equal(resolvePausedUntil(undefined), '2026-10-01');
  assert.equal(resolvePausedUntil('2026-09-20'), '2026-09-20');
  assert.equal(resolvePausedUntil('off'), null);
  assert.equal(scheduledBroadcastsPaused(new Date('2026-09-17T09:00:00.000Z'), null), false);
});

test('a paused scheduler neither sends nor marks the day as sent', async () => {
  const calls: string[] = [];
  const scheduler = new DailyDigestScheduler({
    settings: {
      async listDailyEnabled() {
        const defaults = defaultDigestSettings('p1');
        return [{ ...defaults, daily: { ...defaults.daily, enabled: true, hour: 9, daysOfWeek: [4] } }];
      },
      async markDailySent() { calls.push('mark'); },
    } as never,
    send: { async execute() { calls.push('send'); } } as never,
    isPaused: (at) => scheduledBroadcastsPaused(at, '2026-10-01'),
  });
  await scheduler.tick(new Date('2026-09-24T06:01:00.000Z')); // Thursday 09:01 MSK, пауза
  assert.deepEqual(calls, []);
  await scheduler.tick(new Date('2026-10-01T06:01:00.000Z')); // Thursday 09:01 MSK, пауза снята
  assert.deepEqual(calls, ['send', 'mark']);
});
