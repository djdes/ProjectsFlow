import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeCustomSlots,
  firstFreeCustomSlot,
  kanbanColumnOrder,
  resolveColumnColor,
  resolveColumnLabel,
} from './KanbanSettings.js';

test('без кастомных колонок порядок — четыре встроенные', () => {
  assert.deepEqual(kanbanColumnOrder(null), ['backlog', 'manual', 'todo', 'done']);
  assert.deepEqual(kanbanColumnOrder({ todo: { color: 'red' } }), [
    'backlog',
    'manual',
    'todo',
    'done',
  ]);
});

test('слот без label колонкой не считается', () => {
  const settings = { custom_1: { color: 'red' as const }, custom_2: { label: '   ' } };
  assert.deepEqual(activeCustomSlots(settings), []);
  assert.deepEqual(kanbanColumnOrder(settings), ['backlog', 'manual', 'todo', 'done']);
  assert.equal(firstFreeCustomSlot(settings), 'custom_1');
});

test('кастомная колонка без position уходит в конец', () => {
  assert.deepEqual(kanbanColumnOrder({ custom_2: { label: 'Ревью' } }), [
    'backlog',
    'manual',
    'todo',
    'done',
    'custom_2',
  ]);
});

test('position вставляет колонку между встроенными; порядок не зависит от порядка ключей', () => {
  const a = kanbanColumnOrder({
    custom_3: { label: 'Позже', position: 3 },
    custom_1: { label: 'Раньше', position: 1 },
  });
  const b = kanbanColumnOrder({
    custom_1: { label: 'Раньше', position: 1 },
    custom_3: { label: 'Позже', position: 3 },
  });
  assert.deepEqual(a, b);
  assert.deepEqual(a, ['backlog', 'custom_1', 'manual', 'custom_3', 'todo', 'done']);
});

test('position за пределами списка не роняет порядок', () => {
  assert.deepEqual(kanbanColumnOrder({ custom_1: { label: 'Хвост', position: 99 } }), [
    'backlog',
    'manual',
    'todo',
    'done',
    'custom_1',
  ]);
});

test('подпись и цвет кастомной колонки: label из настроек, фолбэк «Колонка N» и серый', () => {
  assert.equal(resolveColumnLabel({ label: 'Ревью' }, 'custom_2'), 'Ревью');
  assert.equal(resolveColumnLabel(undefined, 'custom_2'), 'Колонка 2');
  assert.equal(resolveColumnColor(undefined, undefined, 'custom_2'), 'gray');
  assert.equal(resolveColumnColor({ color: 'purple' }, undefined, 'custom_2'), 'purple');
  // Встроенные колонки ведут себя как раньше.
  assert.equal(resolveColumnColor(undefined, undefined, 'done'), 'green');
});

test('пять занятых слотов — свободных нет', () => {
  const full = {
    custom_1: { label: 'A' },
    custom_2: { label: 'B' },
    custom_3: { label: 'C' },
    custom_4: { label: 'D' },
    custom_5: { label: 'E' },
  };
  assert.equal(firstFreeCustomSlot(full), null);
  assert.equal(activeCustomSlots(full).length, 5);
});
