import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  instantOfDateOnly,
  nextOccurrence,
  nextOccurrenceAfterDeadline,
  normalizeTaskRecurrence,
  parseTaskRecurrence,
  sameTaskRecurrence,
  serializeTaskRecurrence,
  type TaskRecurrence,
} from './TaskRecurrence.js';
import { resetChecklist } from './checklist.js';

// Даты задаём как календарные дни: полдень по Москве, чтобы граница суток не мешала.
const day = (iso: string): Date => instantOfDateOnly(iso);
const next = (rule: TaskRecurrence, from: string, today: string): string =>
  nextOccurrence(rule, day(from), day(today));

const DAILY: TaskRecurrence = { kind: 'daily' };
const WEEKDAYS: TaskRecurrence = { kind: 'weekdays' };

// 2026-11-16 — понедельник.

test('daily: the next day after a deadline that is today', () => {
  assert.equal(next(DAILY, '2026-11-17', '2026-11-17'), '2026-11-18');
});

test('daily: an overdue task never spawns a copy in the past', () => {
  assert.equal(next(DAILY, '2026-11-10', '2026-11-17'), '2026-11-18');
});

test('daily: a task done ahead of time keeps its schedule', () => {
  assert.equal(next(DAILY, '2026-11-20', '2026-11-17'), '2026-11-21');
});

test('daily: crosses month and year boundaries', () => {
  assert.equal(next(DAILY, '2026-11-30', '2026-11-30'), '2026-12-01');
  assert.equal(next(DAILY, '2026-12-31', '2026-12-31'), '2027-01-01');
  assert.equal(next(DAILY, '2028-02-28', '2028-02-28'), '2028-02-29');
});

test('weekdays: Thursday → Friday, Friday and the weekend → Monday', () => {
  assert.equal(next(WEEKDAYS, '2026-11-19', '2026-11-19'), '2026-11-20');
  assert.equal(next(WEEKDAYS, '2026-11-20', '2026-11-20'), '2026-11-23');
  assert.equal(next(WEEKDAYS, '2026-11-21', '2026-11-21'), '2026-11-23');
  assert.equal(next(WEEKDAYS, '2026-11-22', '2026-11-22'), '2026-11-23');
});

test('weekdays: an overdue Friday task done on Sunday moves to Monday', () => {
  assert.equal(next(WEEKDAYS, '2026-11-20', '2026-11-22'), '2026-11-23');
});

test('weekly: picks the next selected day within the week', () => {
  const monThu: TaskRecurrence = { kind: 'weekly', days: [1, 4] };
  assert.equal(next(monThu, '2026-11-16', '2026-11-16'), '2026-11-19');
  assert.equal(next(monThu, '2026-11-17', '2026-11-17'), '2026-11-19');
});

test('weekly: wraps to the next week', () => {
  const monThu: TaskRecurrence = { kind: 'weekly', days: [1, 4] };
  assert.equal(next(monThu, '2026-11-19', '2026-11-19'), '2026-11-23');
  const sunday: TaskRecurrence = { kind: 'weekly', days: [7] };
  assert.equal(next(sunday, '2026-11-22', '2026-11-22'), '2026-11-29');
  assert.equal(next(sunday, '2026-11-16', '2026-11-16'), '2026-11-22');
});

test('weekly: a single day equal to the deadline weekday repeats in 7 days', () => {
  const wednesday: TaskRecurrence = { kind: 'weekly', days: [3] };
  assert.equal(next(wednesday, '2026-11-18', '2026-11-18'), '2026-11-25');
});

test('weekly: wraps across the year boundary', () => {
  const friday: TaskRecurrence = { kind: 'weekly', days: [5] };
  // 2026-12-31 — четверг.
  assert.equal(next(friday, '2026-12-31', '2026-12-31'), '2027-01-01');
  assert.equal(next(friday, '2027-01-01', '2027-01-01'), '2027-01-08');
});

test('monthly: the same day of the next month', () => {
  const fifteenth: TaskRecurrence = { kind: 'monthly', day: 15 };
  assert.equal(next(fifteenth, '2026-11-15', '2026-11-15'), '2026-12-15');
  assert.equal(next(fifteenth, '2026-11-10', '2026-11-10'), '2026-11-15');
});

test('monthly: the 31st falls on the last day of short months without drifting', () => {
  const last: TaskRecurrence = { kind: 'monthly', day: 31 };
  assert.equal(next(last, '2026-01-31', '2026-01-31'), '2026-02-28');
  assert.equal(next(last, '2026-02-28', '2026-02-28'), '2026-03-31');
  assert.equal(next(last, '2026-03-31', '2026-03-31'), '2026-04-30');
  assert.equal(next(last, '2026-04-30', '2026-04-30'), '2026-05-31');
});

test('monthly: leap years give February 29th', () => {
  const thirtieth: TaskRecurrence = { kind: 'monthly', day: 30 };
  assert.equal(next(thirtieth, '2028-01-30', '2028-01-30'), '2028-02-29');
  assert.equal(next(thirtieth, '2028-02-29', '2028-02-29'), '2028-03-30');
});

test('monthly: December wraps to January of the next year', () => {
  const last: TaskRecurrence = { kind: 'monthly', day: 31 };
  assert.equal(next(last, '2026-12-31', '2026-12-31'), '2027-01-31');
});

test('monthly: an overdue task jumps to the first future date of the rule', () => {
  const fifth: TaskRecurrence = { kind: 'monthly', day: 5 };
  assert.equal(next(fifth, '2026-08-05', '2026-11-17'), '2026-12-05');
  assert.equal(next(fifth, '2026-08-05', '2026-11-04'), '2026-11-05');
});

test('the result is always strictly after today', () => {
  const rules: TaskRecurrence[] = [
    DAILY,
    WEEKDAYS,
    { kind: 'weekly', days: [2, 6] },
    { kind: 'monthly', day: 29 },
  ];
  for (const rule of rules) {
    for (let offset = -40; offset <= 40; offset += 3) {
      const from = new Date(day('2026-11-17').getTime() + offset * 86_400_000);
      assert.ok(nextOccurrence(rule, from, day('2026-11-17')) > '2026-11-17');
    }
  }
});

test('timezone: "today" is the Moscow date, not the UTC one', () => {
  // 21:30 UTC 17 ноября = 00:30 МСК 18 ноября: для пользователя уже 18-е.
  const lateEvening = new Date('2026-11-17T21:30:00Z');
  assert.equal(nextOccurrence(DAILY, lateEvening, lateEvening), '2026-11-19');
  // 20:59 UTC = 23:59 МСК — ещё 17-е.
  const beforeMidnight = new Date('2026-11-17T20:59:00Z');
  assert.equal(nextOccurrence(DAILY, beforeMidnight, beforeMidnight), '2026-11-18');
});

test('timezone: a stored deadline keeps its calendar date', () => {
  const now = new Date('2026-11-17T22:30:00Z'); // 01:30 МСК 18 ноября
  assert.equal(nextOccurrenceAfterDeadline(DAILY, '2026-11-20', now), '2026-11-21');
  assert.equal(nextOccurrenceAfterDeadline(DAILY, null, now), '2026-11-19');
  // Срок, распарсенный как полночь UTC, тоже остаётся своей датой (03:00 МСК).
  assert.equal(nextOccurrence(DAILY, new Date('2026-11-20'), now), '2026-11-21');
});

test('serialize/parse round-trip', () => {
  const rules: TaskRecurrence[] = [
    DAILY,
    WEEKDAYS,
    { kind: 'weekly', days: [1, 3, 5] },
    { kind: 'monthly', day: 31 },
  ];
  for (const rule of rules) {
    assert.deepEqual(parseTaskRecurrence(serializeTaskRecurrence(rule)), rule);
  }
  assert.equal(serializeTaskRecurrence(null), null);
  assert.equal(parseTaskRecurrence(null), null);
});

test('parse: broken stored values read as "no recurrence"', () => {
  for (const raw of ['', 'hourly', 'daily:1', 'weekly:', 'weekly:0', 'weekly:1,8', 'monthly:0', 'monthly:32', 'monthly:x']) {
    assert.equal(parseTaskRecurrence(raw), null, raw);
  }
});

test('normalize: sorts and dedupes weekdays, rejects invalid rules', () => {
  assert.deepEqual(normalizeTaskRecurrence({ kind: 'weekly', days: [5, 1, 5] }), { kind: 'weekly', days: [1, 5] });
  assert.equal(normalizeTaskRecurrence({ kind: 'weekly', days: [] }), null);
  assert.equal(normalizeTaskRecurrence({ kind: 'weekly', days: [0, 1] }), null);
  assert.equal(normalizeTaskRecurrence({ kind: 'monthly', day: 0 }), null);
  assert.equal(normalizeTaskRecurrence({ kind: 'monthly', day: 1.5 }), null);
  assert.equal(normalizeTaskRecurrence({ kind: 'yearly' }), null);
  assert.equal(normalizeTaskRecurrence(null), null);
});

test('sameTaskRecurrence compares by value', () => {
  assert.ok(sameTaskRecurrence({ kind: 'weekly', days: [1, 2] }, { kind: 'weekly', days: [1, 2] }));
  assert.ok(!sameTaskRecurrence({ kind: 'weekly', days: [1] }, { kind: 'weekly', days: [1, 2] }));
  assert.ok(sameTaskRecurrence(null, undefined));
});

test('resetChecklist unchecks items and leaves code blocks alone', () => {
  const src = [
    'Утренний обход',
    '- [x] Проверить почту',
    '- [X] Созвон',
    '  * [x] вложенный пункт',
    '1. [x] нумерованный',
    '- [ ] ещё не сделано',
    '```',
    '- [x] пример в коде',
    '```',
    'Текст с [x] посередине',
  ].join('\n');
  assert.equal(
    resetChecklist(src),
    [
      'Утренний обход',
      '- [ ] Проверить почту',
      '- [ ] Созвон',
      '  * [ ] вложенный пункт',
      '1. [ ] нумерованный',
      '- [ ] ещё не сделано',
      '```',
      '- [x] пример в коде',
      '```',
      'Текст с [x] посередине',
    ].join('\n'),
  );
});
