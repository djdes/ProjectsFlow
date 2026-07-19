import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiActionBatch, AiActionBatchItem, AiActionBatchStatus } from './AiActionBatch.js';
import { collectAiActionArtifacts } from './AiActionArtifact.js';

function item(overrides: Partial<AiActionBatchItem> = {}): AiActionBatchItem {
  return {
    id: 'item-1',
    batchId: 'batch-1',
    position: 0,
    actionId: 'a1',
    type: 'create_task',
    entityKind: 'task',
    entityId: 'task-1',
    projectId: 'project-1',
    title: 'Сверстать макет',
    status: 'done',
    before: null,
    errorMessage: null,
    ...overrides,
  };
}

function batch(items: AiActionBatchItem[], status: AiActionBatchStatus = 'applied'): AiActionBatch {
  const at = new Date('2026-07-19T10:00:00.000Z');
  return {
    id: 'batch-1',
    conversationId: 'conv-1',
    messageId: 'msg-1',
    ownerUserId: 'user-1',
    projectId: 'project-1',
    status,
    title: 'Действия ассистента',
    idempotencyKey: 'msg-1',
    createdBy: 'user-1',
    appliedAt: at,
    undoneAt: null,
    createdAt: at,
    updatedAt: at,
    items,
  };
}

test('collects created and updated entities in plan order', () => {
  const artifacts = collectAiActionArtifacts([batch([
    item({ id: 'i2', position: 1, type: 'update_task', title: 'Обновить макет' }),
    item({ id: 'i1', position: 0, type: 'create_project', entityKind: 'project', title: 'Проект «Сайт»' }),
  ])]);
  assert.deepEqual(artifacts.map((artifact) => artifact.id), ['i1', 'i2']);
  assert.deepEqual(artifacts.map((artifact) => artifact.action), ['created', 'updated']);
});

test('is a journal, not workspace state: deletions never remove earlier cards', () => {
  const created = batch([item({ id: 'i1' })]);
  const deleted = batch([item({ id: 'i2', type: 'delete_task', actionId: 'a2' })]);
  const artifacts = collectAiActionArtifacts([created, deleted]);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0]?.id, 'i1');
});

test('keeps rolled-back items but marks them undone', () => {
  const artifacts = collectAiActionArtifacts([batch([item({ status: 'undone' })], 'undone')]);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0]?.undone, true);
});

test('skips actions that never happened', () => {
  const rejected = collectAiActionArtifacts([batch([item()], 'rejected')]);
  assert.deepEqual(rejected, []);
  const failed = collectAiActionArtifacts([batch([item({ status: 'failed' }), item({ id: 'i2', status: 'pending' })])]);
  assert.deepEqual(failed, []);
});
