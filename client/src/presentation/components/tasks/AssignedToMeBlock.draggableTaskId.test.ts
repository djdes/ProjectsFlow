import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { draggableTaskId } from './AssignedToMeBlock';

// tsx компилирует .tsx классическим JSX-рантаймом — React должен быть глобальным
// (тот же приём, что в InboxCheckbox.rollback.test.ts).
(globalThis as typeof globalThis & { React: typeof React }).React = React;

// draggableTaskId — чистое решение, вынесенное из DraggableTask специально под тест
// (ревью, находка Important 1: призрак useExitingListItems дублировал dnd-id живой
// карточки). Прямой тест «карточка не регистрируется как draggable» невозможен без
// монтирования полного DndContext + двух конкурирующих DraggableTask с одним item.id —
// вместо этого тестируем ГАРАНТИЮ, на которой держится фикс: ghost-карточка ВСЕГДА
// получает id, отличный от live-карточки той же задачи, поэтому unmount призрака (см.
// @dnd-kit/core useDraggable: draggableNodes.delete(id) только когда node.key === key)
// физически не может задеть запись живой карточки в draggableNodes.
test('draggableTaskId: ghost id never collides with the live id of the same task', () => {
  const live = draggableTaskId('task-1', false);
  const ghost = draggableTaskId('task-1', true);
  assert.notEqual(live, ghost);
});

test('draggableTaskId: live id is stable (matches what drop/drag handlers expect elsewhere)', () => {
  assert.equal(draggableTaskId('task-42', false), 'assigned-task-42');
});

test('draggableTaskId: ghost id is derived from the same item id (still traceable in devtools)', () => {
  const ghost = draggableTaskId('task-42', true);
  assert.equal(ghost, 'assigned-ghost-task-42');
  assert.ok(ghost.includes('task-42'));
});

test('draggableTaskId: two different tasks never collide regardless of ghost flag', () => {
  assert.notEqual(draggableTaskId('task-1', true), draggableTaskId('task-2', true));
  assert.notEqual(draggableTaskId('task-1', false), draggableTaskId('task-2', false));
});
