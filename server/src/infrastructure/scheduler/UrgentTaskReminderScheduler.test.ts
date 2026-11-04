import assert from 'node:assert/strict';
import test from 'node:test';
import type { UrgentReminderSlot } from '../../domain/task/urgentTaskReminder.js';
import { UrgentTaskReminderScheduler } from './UrgentTaskReminderScheduler.js';

function setup(opts: { paused?: boolean; fail?: boolean } = {}) {
  const slots: string[] = [];
  let fail = opts.fail ?? false;
  const scheduler = new UrgentTaskReminderScheduler({
    send: {
      execute: async (slot: UrgentReminderSlot) => {
        slots.push(slot.key);
        if (fail) {
          fail = false;
          throw new Error('db down');
        }
        return { taskCount: 0, personalSent: 0, groupSent: 0 };
      },
    },
    isPaused: () => opts.paused ?? false,
  });
  return { scheduler, slots };
}

// 2026-11-04 is a Wednesday; MSK = UTC+3.
const msk = (hhmm: string, date = '2026-11-04') => new Date(`${date}T${hhmm}:00+03:00`);

test('runs once per slot at 08:00 and 16:00 MSK', async () => {
  const { scheduler, slots } = setup();
  await scheduler.tick(msk('07:59'));
  await scheduler.tick(msk('08:00'));
  await scheduler.tick(msk('08:01'));
  await scheduler.tick(msk('12:00'));
  await scheduler.tick(msk('16:00'));
  await scheduler.tick(msk('16:30'));
  assert.deepEqual(slots, ['2026-11-04@08', '2026-11-04@16']);
});

test('a process started at 08:03 catches up, one started at 15:00 does not send the morning slot', async () => {
  const late = setup();
  await late.scheduler.tick(msk('08:03'));
  assert.deepEqual(late.slots, ['2026-11-04@08']);

  const afternoon = setup();
  await afternoon.scheduler.tick(msk('15:00'));
  assert.deepEqual(afternoon.slots, []);
});

test('weekends and broadcast pause are silent', async () => {
  const weekend = setup();
  await weekend.scheduler.tick(msk('08:00', '2026-11-07'));
  await weekend.scheduler.tick(msk('16:00', '2026-11-08'));
  assert.deepEqual(weekend.slots, []);

  const paused = setup({ paused: true });
  await paused.scheduler.tick(msk('08:00'));
  assert.deepEqual(paused.slots, []);
});

test('a failed run is retried on the next tick of the same slot', async () => {
  const { scheduler, slots } = setup({ fail: true });
  await assert.rejects(scheduler.tick(msk('08:00')));
  await scheduler.tick(msk('08:01'));
  await scheduler.tick(msk('08:02'));
  assert.deepEqual(slots, ['2026-11-04@08', '2026-11-04@08']);
});
