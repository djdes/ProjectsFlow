import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveMoveTarget,
  shouldAutoMoveAfterComment,
} from './taskDrawerComposerRules';
import type { Task } from '@/domain/task/Task';

function taskWithAssignee(userId: string): Pick<Task, 'assignee'> {
  return { assignee: { userId, displayName: 'Кто-то', avatarUrl: null } };
}

// BUG C (стейдж 4): руководитель открыл задачу сотрудника, написал комментарий — задача
// уехала из «В работе» в другую колонку. Автоперенос обязан срабатывать только когда
// комментатор — исполнитель задачи (своя задача), иначе комментарий отправляется как есть.
test('shouldAutoMoveAfterComment: чужая задача — move не разрешён', () => {
  const task = taskWithAssignee('assignee-1');
  assert.equal(shouldAutoMoveAfterComment(task, 'commenter-2'), false);
});

test('shouldAutoMoveAfterComment: своя задача — move разрешён (прежнее поведение)', () => {
  const task = taskWithAssignee('user-1');
  assert.equal(shouldAutoMoveAfterComment(task, 'user-1'), true);
});

test('shouldAutoMoveAfterComment: неизвестный текущий юзер — move не разрешён', () => {
  const task = taskWithAssignee('assignee-1');
  assert.equal(shouldAutoMoveAfterComment(task, null), false);
});

test('resolveMoveTarget: draft — двигает всё кроме backlog', () => {
  assert.equal(resolveMoveTarget('backlog', 'draft'), null);
  assert.equal(resolveMoveTarget('in_progress', 'draft'), 'backlog');
  assert.equal(resolveMoveTarget('todo', 'draft'), 'backlog');
});

test('resolveMoveTarget: worker — двигает всё кроме todo', () => {
  assert.equal(resolveMoveTarget('todo', 'worker'), null);
  assert.equal(resolveMoveTarget('in_progress', 'worker'), 'todo');
  assert.equal(resolveMoveTarget('backlog', 'worker'), 'todo');
});

// Задача, положенная в «Вручную», обязана там и остаться: комментарий (или правка,
// которая шлётся тем же композером) не выдёргивает её в «Черновики»/«Воркеру».
test('resolveMoveTarget: «Вручную» не двигается ни одним target', () => {
  assert.equal(resolveMoveTarget('manual', 'draft'), null);
  assert.equal(resolveMoveTarget('manual', 'worker'), null);
});

test('resolveMoveTarget: кастомные колонки тоже не двигаются', () => {
  assert.equal(resolveMoveTarget('custom_1', 'draft'), null);
  assert.equal(resolveMoveTarget('custom_1', 'worker'), null);
  assert.equal(resolveMoveTarget('custom_5', 'draft'), null);
  assert.equal(resolveMoveTarget('custom_5', 'worker'), null);
});
