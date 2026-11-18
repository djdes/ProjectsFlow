import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTaskPropertyOrder, reorderTaskProperties, TASK_PROPERTY_KEYS } from './UiPrefs';

test('saved property layouts retain their order, drop creation metadata and add new fields', () => {
  const saved = ['files', 'created', 'assignee', 'unknown', 'files', 'priority'];
  const order = normalizeTaskPropertyOrder(saved);
  assert.deepEqual(order.slice(0, 3), ['files', 'assignee', 'priority']);
  assert.deepEqual(new Set(order), new Set(TASK_PROPERTY_KEYS));
  assert.ok(!order.includes('created' as never));
  const moved = reorderTaskProperties(order, 'project', 'files');
  assert.equal(moved[0], 'project');
  assert.equal(order[0], 'files');
  assert.deepEqual(normalizeTaskPropertyOrder(moved), moved);
});

test('a saved layout gets the new «Повтор» row right under the deadline', () => {
  const saved = ['status', 'project', 'assignee', 'approver', 'priority', 'deadline', 'taskType', 'mode', 'files'];
  assert.deepEqual(normalizeTaskPropertyOrder(saved), [
    'status', 'project', 'assignee', 'approver', 'priority', 'deadline', 'recurrence', 'taskType', 'mode', 'runMode', 'files',
  ]);
  // Срока в сохранённом порядке нет — «Повтор» дописывается следом за ним, в конец.
  const partial = normalizeTaskPropertyOrder(['files', 'status']);
  assert.deepEqual(new Set(partial), new Set(TASK_PROPERTY_KEYS));
  assert.deepEqual(partial.slice(0, 2), ['files', 'status']);
  assert.equal(partial[partial.indexOf('deadline') + 1], 'recurrence');
});
