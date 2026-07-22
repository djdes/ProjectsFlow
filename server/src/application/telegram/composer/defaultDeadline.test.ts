import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endOfWeekDeadline } from './defaultDeadline.js';

// Локальная дата без UTC-сдвига: срок — календарный день пользователя, не момент времени.
const at = (y: number, m: number, d: number): Date => new Date(y, m - 1, d, 12, 0, 0);

test('среди недели — ближайшая пятница', () => {
  assert.equal(endOfWeekDeadline(at(2026, 7, 20)), '2026-07-24'); // понедельник → пятница
  assert.equal(endOfWeekDeadline(at(2026, 7, 22)), '2026-07-24'); // среда → та же пятница
  assert.equal(endOfWeekDeadline(at(2026, 7, 23)), '2026-07-24'); // четверг → завтра
});

// Главный смысл правила: срок не должен оказаться «сегодня вечером» или в прошлом.
test('в пятницу и на выходных — пятница следующей недели', () => {
  assert.equal(endOfWeekDeadline(at(2026, 7, 24)), '2026-07-31'); // пятница → следующая
  assert.equal(endOfWeekDeadline(at(2026, 7, 25)), '2026-07-31'); // суббота
  assert.equal(endOfWeekDeadline(at(2026, 7, 26)), '2026-07-31'); // воскресенье
});

test('срок никогда не раньше завтрашнего дня', () => {
  for (let i = 0; i < 21; i++) {
    const now = at(2026, 7, 20 + i);
    const deadline = endOfWeekDeadline(now);
    assert.ok(deadline > toIso(now), `${deadline} должен быть позже ${toIso(now)}`);
  }
});

test('переход через границу месяца считается корректно', () => {
  assert.equal(endOfWeekDeadline(at(2026, 7, 29)), '2026-07-31'); // среда → пятница того же месяца
  assert.equal(endOfWeekDeadline(at(2026, 9, 30)), '2026-10-02'); // среда → пятница уже в октябре
});

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
