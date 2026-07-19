import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiAction, AiAffectedEntity } from '@/domain/ai-action/AiAction';
import type { AiActionBatch, AiActionBatchItem } from '@/domain/ai-action/AiActionBatch';
import { canUndoAiActionBatch } from '@/domain/ai-action/AiActionBatch';
import {
  batchDestructiveEntities,
  batchListedEntities,
  batchOutcome,
  buildBatchPlanItems,
  summarizeBatch,
} from './aiActionBatchPlan';

const PROJECT = 'project-1';

function item(patch: Partial<AiActionBatchItem>): AiActionBatchItem {
  return {
    id: 'item-1',
    position: 0,
    actionId: 'a1',
    type: 'create_task',
    entityKind: 'task',
    entityId: 'task-1',
    projectId: PROJECT,
    title: 'Задача',
    status: 'done',
    errorMessage: null,
    ...patch,
  };
}

function batch(patch: Partial<AiActionBatch>): AiActionBatch {
  return {
    id: 'batch-1',
    conversationId: 'conv-1',
    messageId: 'msg-1',
    projectId: PROJECT,
    status: 'applied',
    title: 'План',
    appliedAt: '2026-07-19T10:00:00.000Z',
    undoneAt: null,
    createdAt: '2026-07-19T10:00:00.000Z',
    items: [],
    ...patch,
  };
}

test('creative actions enter the journal without an entity id, updates carry theirs', () => {
  const actions: AiAction[] = [
    { id: 'a1', type: 'create_project', name: 'Docs' },
    { id: 'a2', type: 'create_task', projectRef: 'a1', description: 'Настроить главную\nвторая строка' },
    { id: 'a3', type: 'update_task', projectId: PROJECT, taskId: 'task-9', description: 'Правка' },
  ];

  const items = buildBatchPlanItems(actions, [], (action) => (action.type === 'update_task' ? PROJECT : null));

  assert.deepEqual(items.map((i) => i.entityId), [null, null, 'task-9']);
  assert.deepEqual(items.map((i) => i.entityKind), ['project', 'task', 'task']);
  assert.equal(items[0]?.title, 'Проект «Docs»');
  assert.equal(items[1]?.title, 'Настроить главную');
});

test('a bulk deletion expands into one journal row per task so each can be restored separately', () => {
  const affected: AiAffectedEntity[] = [
    { actionId: 'd1', kind: 'task', projectId: PROJECT, entityId: 'task-1', title: 'Первая' },
    { actionId: 'd1', kind: 'task', projectId: PROJECT, entityId: 'task-2', title: 'Вторая' },
    { actionId: 'd1', kind: 'task', projectId: PROJECT, entityId: 'task-3', title: 'Третья' },
  ];

  const items = buildBatchPlanItems([], affected, () => PROJECT);

  assert.equal(items.length, 3);
  assert.deepEqual(items.map((i) => i.entityId), ['task-1', 'task-2', 'task-3']);
  assert.ok(items.every((i) => i.actionId === 'd1' && i.type === 'delete_task'));
});

test('the review list is read back from the journal, so it survives a reload', () => {
  const value = batch({
    status: 'pending_review',
    items: [
      item({ id: 'i1', type: 'create_task', status: 'done', entityId: 'task-1' }),
      item({ id: 'i2', actionId: 'd1', type: 'delete_task', status: 'pending', entityId: 'task-2', title: 'Старая' }),
    ],
  });

  const entities = batchDestructiveEntities(value);

  assert.equal(entities.length, 1);
  assert.equal(entities[0]?.entityId, 'task-2');
  assert.equal(entities[0]?.title, 'Старая');
});

test('a rejected batch never lists the tasks it was going to delete', () => {
  const value = batch({
    status: 'rejected',
    items: [
      item({ id: 'i1', type: 'create_task', status: 'done', entityId: 'task-1' }),
      item({ id: 'i2', actionId: 'd1', type: 'delete_task', status: 'done', entityId: 'task-2' }),
    ],
  });

  const listed = batchListedEntities(value, batchOutcome(value.status));

  assert.deepEqual(listed.map((entity) => entity.entityId), ['task-1']);
});

test('counts separate created, failed and deleted so the summary cannot double-count', () => {
  const value = batch({
    items: [
      item({ id: 'i1', type: 'create_task', status: 'done' }),
      item({ id: 'i2', type: 'create_task', status: 'failed' }),
      item({ id: 'i3', type: 'update_task', status: 'undone' }),
      item({ id: 'i4', actionId: 'd1', type: 'delete_task', status: 'done' }),
      item({ id: 'i5', actionId: 'd1', type: 'delete_task', status: 'pending' }),
    ],
  });

  assert.deepEqual(summarizeBatch(value), { done: 2, failed: 1, removed: 1 });
});

test('undo is offered only for an applied batch that actually did something', () => {
  const executed = [item({ status: 'done' })];
  assert.equal(canUndoAiActionBatch(batch({ status: 'applied', items: executed })), true);
  assert.equal(canUndoAiActionBatch(batch({ status: 'undone', items: executed })), false);
  assert.equal(canUndoAiActionBatch(batch({ status: 'rejected', items: executed })), false);
  assert.equal(canUndoAiActionBatch(batch({ status: 'pending_review', items: executed })), false);
  // Nothing executed — there is nothing to roll back either.
  assert.equal(canUndoAiActionBatch(batch({ status: 'applied', items: [item({ status: 'failed' })] })), false);
});

test('batch status maps onto the three card outcomes', () => {
  assert.equal(batchOutcome('applied'), 'applied');
  assert.equal(batchOutcome('pending_review'), 'applied');
  assert.equal(batchOutcome('rejected'), 'rejected');
  assert.equal(batchOutcome('undone'), 'undone');
});
