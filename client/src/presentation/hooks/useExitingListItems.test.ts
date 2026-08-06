import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeOrderedIds, reconcileExitTimers } from './useExitingListItems';

// mergeOrderedIds — единственная чистая часть useExitingListItems (реконсиляция порядка
// id при появлении/уходе элементов); всё, что зависит от таймеров/React-состояния,
// проверяется вручную (см. stage-3-report.md).

test('mergeOrderedIds: keeps ids missing from nextIds in place (ghosts stay put)', () => {
  const prev = ['a', 'b', 'c'];
  // 'b' пропал из nextIds (уходит/схлопывается) — merge не должен его выбросить,
  // это забота вызывающего таймера, не этой функции.
  const merged = mergeOrderedIds(prev, ['a', 'c']);
  assert.deepEqual(merged, ['a', 'b', 'c']);
});

test('mergeOrderedIds: appends brand-new ids at the end, preserving their relative order', () => {
  const prev = ['a', 'b'];
  const merged = mergeOrderedIds(prev, ['a', 'b', 'd', 'e']);
  assert.deepEqual(merged, ['a', 'b', 'd', 'e']);
});

test('mergeOrderedIds: returns the SAME reference when nothing new appeared (no-op renders)', () => {
  const prev = ['a', 'b', 'c'];
  // nextIds — тот же контент, но НОВАЯ ссылка на массив (как «свежий» tasks.filter(...)
  // от родителя на каждый рендер): merge не обязан пересобирать prevOrder.
  const merged = mergeOrderedIds(prev, ['a', 'b']);
  assert.strictEqual(merged, prev);
});

test('mergeOrderedIds: mixes ghosts and new arrivals in one pass', () => {
  const prev = ['a', 'b', 'c'];
  // 'b' ушёл из данных, 'd' появился — оба случая одновременно.
  const merged = mergeOrderedIds(prev, ['a', 'c', 'd']);
  assert.deepEqual(merged, ['a', 'b', 'c', 'd']);
});

test('mergeOrderedIds: empty prev order just adopts nextIds', () => {
  const merged = mergeOrderedIds([], ['x', 'y']);
  assert.deepEqual(merged, ['x', 'y']);
});

// reconcileExitTimers — решение «завести/снять таймер коллапса», вынесенное из эффекта
// useExitingListItems специально для теста без React/DOM/fake-таймеров (ревью, находка
// Important 2: таймер призрака не отменялся, если элемент вернулся раньше срока).

test('reconcileExitTimers: schedules a timer for an id that just disappeared', () => {
  const { toSchedule, toClear } = reconcileExitTimers(['a', 'b'], ['a'], new Set());
  assert.deepEqual(toSchedule, ['b']);
  assert.deepEqual(toClear, []);
});

test('reconcileExitTimers: does not re-schedule an id that is already timing out', () => {
  const { toSchedule, toClear } = reconcileExitTimers(['a', 'b'], ['a'], new Set(['b']));
  assert.deepEqual(toSchedule, []);
  assert.deepEqual(toClear, []);
});

test('reconcileExitTimers: clears the pending timer when an exiting id comes back alive', () => {
  // 'b' пропало на предыдущем проходе (таймер уже заведён), но теперь снова есть в
  // nextIds — оптимистичный move откатился/данные вернулись раньше `ms`. Без этой ветки
  // уже запущенный таймер всё равно сработал бы и вычистил живой элемент из state.
  const { toSchedule, toClear } = reconcileExitTimers(['a', 'b'], ['a', 'b'], new Set(['b']));
  assert.deepEqual(toClear, ['b']);
  assert.deepEqual(toSchedule, []);
});

test('reconcileExitTimers: a live id with no pending timer needs no action either way', () => {
  const { toSchedule, toClear } = reconcileExitTimers(['a'], ['a'], new Set());
  assert.deepEqual(toSchedule, []);
  assert.deepEqual(toClear, []);
});

test('reconcileExitTimers: mixes schedule and clear in one pass', () => {
  // 'b' just disappeared → schedule. 'c' was exiting and came back → clear.
  const { toSchedule, toClear } = reconcileExitTimers(['a', 'b', 'c'], ['a', 'c'], new Set(['c']));
  assert.deepEqual(toSchedule, ['b']);
  assert.deepEqual(toClear, ['c']);
});
