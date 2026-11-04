import assert from 'node:assert/strict';
import test from 'node:test';
import {
  currentUrgentReminderSlot,
  formatUrgentDeadline,
  isUrgentTask,
  mentionsUrgent,
  needsUrgentReminder,
} from './urgentTaskReminder.js';

test('urgent word is found in any case and form', () => {
  for (const text of [
    'Срочно поправить форму',
    'поправить форму СРОЧНО!',
    'Срочная задача',
    'нужен срочный фикс',
    '#срочно',
    'Сверхсрочно: упал прод',
    'Заголовок\nв описании: срочно, до обеда',
  ]) {
    assert.equal(mentionsUrgent(text), true, text);
  }
});

test('urgent word is not caught inside other words or when negated', () => {
  for (const text of [
    'Несрочно, когда будет время',
    'это не срочно',
    'Не  срочная правка',
    'бессрочный договор',
    'Обычная задача',
    '',
  ]) {
    assert.equal(mentionsUrgent(text), false, text);
  }
  assert.equal(mentionsUrgent(null), false);
  assert.equal(mentionsUrgent('не срочно, но вот это срочно'), true);
});

test('priority 1 and 2 are urgent, 3 and 4 are not', () => {
  assert.equal(isUrgentTask({ priority: 1, description: 'x' }), true);
  assert.equal(isUrgentTask({ priority: 2, description: 'x' }), true);
  assert.equal(isUrgentTask({ priority: 3, description: 'x' }), false);
  assert.equal(isUrgentTask({ priority: 4, description: null }), false);
  assert.equal(isUrgentTask({ priority: null, description: 'срочно' }), true);
});

test('only open statuses that still need work are reminded', () => {
  const urgent = { priority: 1 as const, description: 'x' };
  for (const status of ['todo', 'in_progress', 'awaiting_clarification', 'manual', 'custom_3'] as const) {
    assert.equal(needsUrgentReminder({ ...urgent, status }), true, status);
  }
  for (const status of ['backlog', 'pending_approval', 'done'] as const) {
    assert.equal(needsUrgentReminder({ ...urgent, status }), false, status);
  }
});

const clock = (hour: number, minute: number, dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 3) => ({
  date: '2026-11-04',
  hour,
  minute,
  dayOfWeek,
});

test('slots are 08:00 and 16:00 on weekdays', () => {
  assert.deepEqual(currentUrgentReminderSlot(clock(8, 0)), {
    key: '2026-11-04@08',
    date: '2026-11-04',
    hour: 8,
  });
  assert.equal(currentUrgentReminderSlot(clock(16, 0))?.key, '2026-11-04@16');
  assert.equal(currentUrgentReminderSlot(clock(7, 59)), null);
  assert.equal(currentUrgentReminderSlot(clock(15, 59)), null);
  assert.equal(currentUrgentReminderSlot(clock(8, 0, 6)), null);
  assert.equal(currentUrgentReminderSlot(clock(16, 0, 0)), null);
  assert.equal(currentUrgentReminderSlot(clock(8, 0, 1))?.key, '2026-11-04@08');
  assert.equal(currentUrgentReminderSlot(clock(16, 0, 5))?.key, '2026-11-04@16');
});

test('a late start catches up within two hours but never sends the morning slot in the afternoon', () => {
  assert.equal(currentUrgentReminderSlot(clock(8, 3))?.key, '2026-11-04@08');
  assert.equal(currentUrgentReminderSlot(clock(9, 59))?.key, '2026-11-04@08');
  assert.equal(currentUrgentReminderSlot(clock(10, 0)), null);
  assert.equal(currentUrgentReminderSlot(clock(15, 0)), null);
  assert.equal(currentUrgentReminderSlot(clock(17, 59))?.key, '2026-11-04@16');
  assert.equal(currentUrgentReminderSlot(clock(18, 0)), null);
});

test('deadline is shown as a date with the remaining days', () => {
  assert.equal(formatUrgentDeadline('2026-11-05', '2026-11-04'), '05.11 · остался 1 день');
  assert.equal(formatUrgentDeadline('2026-11-04', '2026-11-04'), '04.11 · истекает сегодня');
  assert.equal(formatUrgentDeadline('2026-11-01', '2026-11-04'), '01.11 · просрочено на 3 дня');
  assert.equal(formatUrgentDeadline(null, '2026-11-04'), 'без дедлайна');
});
