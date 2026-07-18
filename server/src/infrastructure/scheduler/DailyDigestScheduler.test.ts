import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultDigestSettings } from '../../domain/digest/DigestSettings.js';
import { DailyDigestScheduler } from './DailyDigestScheduler.js';

function harness(daysOfWeek: Array<0 | 1 | 2 | 3 | 4 | 5 | 6>) {
  const calls: string[] = [];
  const scheduler = new DailyDigestScheduler({
    settings: {
      async listDailyEnabled() {
        const defaults = defaultDigestSettings('p1');
        return [{
          ...defaults,
          daily: { ...defaults.daily, enabled: true, hour: 9, daysOfWeek },
        }];
      },
      async markDailySent() { calls.push('mark'); },
    } as never,
    send: { async execute() { calls.push('send'); } } as never,
  });
  return { scheduler, calls };
}

test('project daily digest skips an unselected Saturday', async () => {
  const { scheduler, calls } = harness([1, 2, 3, 4, 5]);
  await scheduler.tick(new Date('2026-07-18T06:01:00.000Z')); // Saturday 09:01 MSK
  assert.deepEqual(calls, []);
});

test('project daily digest runs when Saturday is explicitly selected', async () => {
  const { scheduler, calls } = harness([6]);
  await scheduler.tick(new Date('2026-07-18T06:01:00.000Z')); // Saturday 09:01 MSK
  assert.deepEqual(calls, ['send', 'mark']);
});
