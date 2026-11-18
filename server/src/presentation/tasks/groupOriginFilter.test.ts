import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onlyFromGroups, wantsFromGroups } from './groupOriginFilter.js';

const tasks = [
  { id: 'a', groupOrigin: { chatId: -1, title: 'Скрипты', authorUserId: null, authorName: 'DJ' } },
  { id: 'b', groupOrigin: null },
  { id: 'c' },
];

test('fromGroups: only 1/true turn the filter on', () => {
  assert.equal(wantsFromGroups({ fromGroups: '1' }), true);
  assert.equal(wantsFromGroups({ fromGroups: 'true' }), true);
  assert.equal(wantsFromGroups({ fromGroups: ['1'] }), true);
  assert.equal(wantsFromGroups({ fromGroups: '0' }), false);
  assert.equal(wantsFromGroups({}), false);
});

test('fromGroups: keeps only tasks with a group origin', () => {
  assert.deepEqual(onlyFromGroups(tasks, { fromGroups: '1' }, (t) => t).map((t) => t.id), ['a']);
  assert.deepEqual(onlyFromGroups(tasks, {}, (t) => t).map((t) => t.id), ['a', 'b', 'c']);
});
