import assert from 'node:assert/strict';
import test from 'node:test';
import { getDefaultTaskDeadline, getTaskCreationDeadline } from './defaultTaskDeadline';

for (const [date, expected] of [
  [12, '2026-10-18'], [13, '2026-10-18'], [14, '2026-10-18'],
  [15, '2026-10-25'], [16, '2026-10-25'], [17, '2026-10-25'], [18, '2026-10-25'],
] as const) {
  test(`default deadline on October ${date}: ${expected}`, () => {
    assert.equal(getDefaultTaskDeadline(new Date(2026, 9, date, 13)), expected);
  });
}

for (const [now, expected] of [
  [new Date(2026, 8, 30, 23, 59), '2026-10-04'],
  [new Date(2026, 9, 1, 0, 1), '2026-10-11'],
  [new Date(2026, 11, 31, 23, 59), '2027-01-10'],
  [new Date(2028, 1, 29, 0, 1), '2028-03-05'],
] as const) {
  test(`default deadline follows local calendar boundaries: ${now.toString()}`, () => {
    const original = now.getTime();
    assert.equal(getDefaultTaskDeadline(now), expected);
    assert.equal(now.getTime(), original);
  });
}

test('date filters are applied without creating overdue work or replacing an explicit empty deadline', () => {
  const friday = new Date(2026, 9, 16, 23, 59);
  assert.equal(getTaskCreationDeadline('today', friday), '2026-10-16');
  assert.equal(getTaskCreationDeadline('week', friday), '2026-10-18');
  assert.equal(getTaskCreationDeadline('week', new Date(2026, 9, 18)), '2026-10-18');
  assert.equal(getTaskCreationDeadline('none', friday), null);
  assert.equal(getTaskCreationDeadline('overdue', friday), '2026-10-25');
  assert.equal(getTaskCreationDeadline(null, friday), '2026-10-25');
});
