import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findNewGroup, groupLabel, parseChatIdInput } from './telegramWorkGroups';

test('parseChatIdInput: only negative group ids, tolerant to copy-paste', () => {
  assert.equal(parseChatIdInput('-1003920622527'), -1003920622527);
  assert.equal(parseChatIdInput('  −100 392 062 2527 '), -1003920622527);
  assert.equal(parseChatIdInput('-42'), -42);
  assert.equal(parseChatIdInput('12'), null);
  assert.equal(parseChatIdInput('abc'), null);
  assert.equal(parseChatIdInput(''), null);
  assert.equal(parseChatIdInput('-99999999999999999999'), null);
});

test('findNewGroup: the group that was not there before', () => {
  const groups = [{ chatId: -1 }, { chatId: -2 }, { chatId: -3 }];
  assert.deepEqual(findNewGroup([-1, -2], groups), { chatId: -3 });
  assert.equal(findNewGroup([-1, -2, -3], groups), null);
});

test('groupLabel: title or a fallback with the id', () => {
  assert.equal(groupLabel({ chatId: -5, title: 'Команда' }), 'Команда');
  assert.equal(groupLabel({ chatId: -5, title: '  ' }), 'Группа -5');
  assert.equal(groupLabel({ chatId: -5, title: null }), 'Группа -5');
});
