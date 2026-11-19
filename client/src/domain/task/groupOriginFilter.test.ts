import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterFromGroups, isFromGroup } from './groupOriginFilter';

const origin = { chatId: -1, title: 'Скрипты', authorUserId: null, authorName: 'DJ' };

test('only tasks with a group origin pass the «from groups» filter', () => {
  const tasks = [{ id: 'a', groupOrigin: origin }, { id: 'b', groupOrigin: null }, { id: 'c' }];
  assert.equal(isFromGroup(tasks[0]!), true);
  assert.equal(isFromGroup(tasks[2]!), false);
  assert.deepEqual(filterFromGroups(tasks, true).map((t) => t.id), ['a']);
  assert.equal(filterFromGroups(tasks, false), tasks);
});
