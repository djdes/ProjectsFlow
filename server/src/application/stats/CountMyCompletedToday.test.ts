import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CountMyCompletedToday } from './CountMyCompletedToday.js';

const NOW = new Date('2026-07-30T12:00:00.000Z');

function make() {
  const calls: { userId: string; since: Date }[] = [];
  const uc = new CountMyCompletedToday({
    activity: {
      countTasksCompletedByActorSince: async (userId: string, since: Date) => {
        calls.push({ userId, since });
        return 3;
      },
    } as never,
  });
  return { uc, calls };
}

test('передаёт локальную полночь клиента как есть', async () => {
  const h = make();
  const midnight = new Date('2026-07-29T21:00:00.000Z'); // полночь в UTC+3

  assert.equal(await h.uc.execute('u1', midnight, NOW), 3);
  assert.deepEqual(h.calls, [{ userId: 'u1', since: midnight }]);
});

test('слишком старое окно зажимается в последние 24 часа', async () => {
  const h = make();

  await h.uc.execute('u1', new Date('2026-01-01T00:00:00.000Z'), NOW);

  assert.equal(h.calls[0]?.since.toISOString(), '2026-07-29T12:00:00.000Z');
});

test('since из будущего зажимается в последние 24 часа', async () => {
  const h = make();

  await h.uc.execute('u1', new Date('2026-07-31T00:00:00.000Z'), NOW);

  assert.equal(h.calls[0]?.since.toISOString(), '2026-07-29T12:00:00.000Z');
});

test('мусор вместо даты не роняет счётчик', async () => {
  const h = make();

  await h.uc.execute('u1', new Date('не дата'), NOW);

  assert.equal(h.calls[0]?.since.toISOString(), '2026-07-29T12:00:00.000Z');
});
