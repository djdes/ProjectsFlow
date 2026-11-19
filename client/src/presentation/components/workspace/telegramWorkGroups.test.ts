import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addableProjects,
  findNewGroup,
  groupLabel,
  groupModeHint,
  groupModeToast,
  groupProjects,
  parseChatIdInput,
  splitGroupsByStatus,
} from './telegramWorkGroups';

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

test('splitGroupsByStatus: drafts apart from connected groups', () => {
  const groups = [
    { chatId: -1, status: 'active' as const },
    { chatId: -2, status: 'draft' as const },
    { chatId: -3, status: 'disconnected' as const },
  ];
  const { drafts, connected } = splitGroupsByStatus(groups);
  assert.deepEqual(drafts.map((g) => g.chatId), [-2]);
  assert.deepEqual(connected.map((g) => g.chatId), [-1, -3]);
});

test('groupProjects / addableProjects: chips and the rest of the workspace projects', () => {
  const projects = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  assert.deepEqual(groupProjects(['c', 'gone', 'a'], projects).map((p) => p.id), ['c', 'a']);
  assert.deepEqual(addableProjects(['c', 'a'], projects).map((p) => p.id), ['b']);
  assert.deepEqual(addableProjects([], projects).map((p) => p.id), ['a', 'b', 'c']);
});

test('groupModeHint: explains the mode; incident without projects warns that nothing is accepted', () => {
  assert.match(groupModeHint('standard', false), /перефразирует/);
  assert.match(groupModeHint('incident', true), /простым языком/);
  assert.match(groupModeHint('incident', false), /Выберите проекты/);
});

test('смешанный режим: подсказка про исполнителя и воркера, без проектов — предупреждение; тост', () => {
  assert.match(groupModeHint('mixed', true), /исполнитель.*воркеру/s);
  assert.match(groupModeHint('mixed', false), /Выберите проекты/);
  assert.match(groupModeToast('mixed'), /смешанный/);
  assert.match(groupModeToast('incident'), /инцидентов/);
  assert.match(groupModeToast('standard'), /обычная/);
});
