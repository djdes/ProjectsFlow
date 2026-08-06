import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeOrderedIds } from './useExitingListItems';

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
