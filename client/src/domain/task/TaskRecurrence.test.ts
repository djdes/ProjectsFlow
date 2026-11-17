import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isoWeekdayOf,
  recurrenceAnchorDate,
  sameTaskRecurrence,
  taskRecurrenceForKind,
  taskRecurrenceLabel,
  toggleRecurrenceWeekday,
} from './TaskRecurrence';

test('weekly and monthly rules are anchored to the deadline', () => {
  // 2026-11-19 — четверг.
  assert.equal(isoWeekdayOf('2026-11-19'), 4);
  assert.equal(isoWeekdayOf('2026-11-22'), 7);
  assert.deepEqual(taskRecurrenceForKind('weekly', '2026-11-19'), { kind: 'weekly', days: [4] });
  assert.deepEqual(taskRecurrenceForKind('monthly', '2026-11-30'), { kind: 'monthly', day: 30 });
  assert.deepEqual(taskRecurrenceForKind('daily', '2026-11-30'), { kind: 'daily' });
});

test('without a deadline the anchor is today', () => {
  assert.equal(recurrenceAnchorDate('2026-12-01', new Date(2026, 10, 17)), '2026-12-01');
  assert.equal(recurrenceAnchorDate(null, new Date(2026, 10, 7)), '2026-11-07');
});

test('toggling weekdays keeps them sorted and never removes the last one', () => {
  const monThu = toggleRecurrenceWeekday({ kind: 'weekly', days: [1] }, 4);
  assert.deepEqual(monThu, { kind: 'weekly', days: [1, 4] });
  assert.deepEqual(toggleRecurrenceWeekday({ kind: 'weekly', days: [4, 1] }, 3), { kind: 'weekly', days: [1, 3, 4] });
  assert.deepEqual(toggleRecurrenceWeekday(monThu, 1), { kind: 'weekly', days: [4] });
  const single = { kind: 'weekly' as const, days: [4 as const] };
  assert.equal(toggleRecurrenceWeekday(single, 4), single);
});

test('labels read like the picker', () => {
  assert.equal(taskRecurrenceLabel({ kind: 'daily' }), 'Каждый день');
  assert.equal(taskRecurrenceLabel({ kind: 'weekdays' }), 'По будням');
  assert.equal(taskRecurrenceLabel({ kind: 'weekly', days: [1, 4] }), 'Каждую неделю: пн, чт');
  assert.equal(taskRecurrenceLabel({ kind: 'weekly', days: [1, 2, 3, 4, 5, 6, 7] }), 'Каждую неделю: все дни');
  assert.equal(taskRecurrenceLabel({ kind: 'monthly', day: 31 }), 'Каждый месяц, 31-го');
});

test('sameTaskRecurrence compares by value', () => {
  assert.ok(sameTaskRecurrence(null, undefined));
  assert.ok(sameTaskRecurrence({ kind: 'weekly', days: [1, 2] }, { kind: 'weekly', days: [1, 2] }));
  assert.ok(!sameTaskRecurrence({ kind: 'weekly', days: [1] }, { kind: 'weekly', days: [1, 2] }));
  assert.ok(!sameTaskRecurrence({ kind: 'monthly', day: 1 }, { kind: 'monthly', day: 2 }));
  assert.ok(!sameTaskRecurrence({ kind: 'daily' }, null));
});
