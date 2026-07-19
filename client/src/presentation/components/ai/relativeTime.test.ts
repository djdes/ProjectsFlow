import assert from 'node:assert/strict';
import test from 'node:test';
import { formatRelativeTime, groupByRecency, recencyGroupLabel } from './relativeTime';

// Полдень, чтобы границы календарных суток не зависели от таймзоны рантайма.
const NOW = new Date(2026, 6, 19, 12, 0, 0).getTime();
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

test('shows «сейчас» under a minute and switches to minutes right after', () => {
  assert.equal(formatRelativeTime(NOW, NOW), 'сейчас');
  assert.equal(formatRelativeTime(NOW - 59_000, NOW), 'сейчас');
  assert.equal(formatRelativeTime(NOW - MINUTE, NOW), '1 мин');
});

test('keeps minutes up to the hour boundary', () => {
  assert.equal(formatRelativeTime(NOW - 59 * MINUTE, NOW), '59 мин');
  assert.equal(formatRelativeTime(NOW - HOUR, NOW), '1 ч');
  assert.equal(formatRelativeTime(NOW - 20 * HOUR, NOW), '20 ч');
});

test('rolls hours into days after 24 hours', () => {
  assert.equal(formatRelativeTime(NOW - 23 * HOUR, NOW), '23 ч');
  assert.equal(formatRelativeTime(NOW - 25 * HOUR, NOW), '1 д');
  assert.equal(formatRelativeTime(NOW - 2 * DAY, NOW), '2 д');
  assert.equal(formatRelativeTime(NOW - 6 * DAY, NOW), '6 д');
});

test('falls back to a date from seven days out', () => {
  assert.equal(formatRelativeTime(NOW - 7 * DAY, NOW), '12 июл');
  assert.equal(formatRelativeTime(new Date(2025, 11, 31, 9, 0, 0).getTime(), NOW), '31 дек 2025');
});

test('treats clock skew from the future as «сейчас»', () => {
  assert.equal(formatRelativeTime(NOW + 5 * MINUTE, NOW), 'сейчас');
});

test('buckets by calendar days, not by elapsed milliseconds', () => {
  const yesterdayEvening = new Date(2026, 6, 18, 23, 30, 0).getTime();
  assert.equal(recencyGroupLabel(new Date(2026, 6, 19, 0, 5, 0).getTime(), NOW), 'Сегодня');
  assert.equal(recencyGroupLabel(yesterdayEvening, NOW), 'Прошлая неделя');
  assert.equal(recencyGroupLabel(NOW - 7 * DAY, NOW), 'Прошлая неделя');
  assert.equal(recencyGroupLabel(NOW - 8 * DAY, NOW), 'Последние 30 дней');
  assert.equal(recencyGroupLabel(NOW - 30 * DAY, NOW), 'Последние 30 дней');
  assert.equal(recencyGroupLabel(NOW - 31 * DAY, NOW), 'Ранее');
});

test('keeps group order and drops empty groups', () => {
  const times = [NOW - 40 * DAY, NOW - HOUR, NOW - 10 * DAY];
  const groups = groupByRecency(times, (time) => time, NOW);
  assert.deepEqual(
    groups.map((group) => group.label),
    ['Сегодня', 'Последние 30 дней', 'Ранее'],
  );
  assert.deepEqual(groups[0].items, [NOW - HOUR]);
});
