import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AssignedTask } from '@/domain/task/AssignedTask';
import type { Task } from '@/domain/task/Task';
import {
  asAssignedInboxBlockTask,
  buildToMeInboxBlockTasks,
  canOpenMemberBoard,
  canSendToApproval,
  isPersonalInboxBlockTask,
  selectApprovalTasks,
  selectBoardTasks,
} from './inboxBlockTasks';

const NOW = new Date('2026-07-14T09:00:00.000Z');

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    projectId: 'inbox-me',
    assignee: { userId: 'me', displayName: 'Ярослав', avatarUrl: null },
    description: id,
    icon: null,
    cover: null,
    coverPosition: 50,
    status: 'todo',
    statusBeforeDone: null,
    position: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ralphMode: 'normal',
    ralphCancelRequestedAt: null,
    ralphCancelRequestedBy: null,
    ralphCancelRequestedByDisplayName: null,
    deadline: null,
    startDate: null,
    parentTaskId: null,
    priority: null,
    taskType: null,
    ...overrides,
  };
}

function assigned(id: string, overrides: Partial<Task> = {}): AssignedTask {
  return {
    ...task(id, { projectId: 'inbox-other', ...overrides }),
    projectName: 'Входящие',
    isInbox: false,
    canModify: true,
  };
}

test('зеркалит назначенные владельцу задачи нижней доски', () => {
  const result = buildToMeInboxBlockTasks({
    assignedTasks: [],
    boardTasks: [task('personal')],
    inboxProjectId: 'inbox-me',
    owner: { id: 'me', displayName: 'Ярослав' },
  });
  const mirror = result[0];
  assert.ok(mirror && isPersonalInboxBlockTask(mirror));
  assert.equal(mirror.assignee.userId, 'me');
  assert.equal(mirror.id, 'personal');
});

test('не зеркалит чужого ответственного и дедуплицирует endpoint', () => {
  const duplicate = assigned('duplicate');
  const result = buildToMeInboxBlockTasks({
    assignedTasks: [duplicate, duplicate],
    boardTasks: [
      task('duplicate'),
      task('foreign', { projectId: 'inbox-other' }),
      task('other-assignee', {
        assignee: { userId: 'other', displayName: 'Олег', avatarUrl: null },
      }),
      task('personal'),
    ],
    inboxProjectId: 'inbox-me',
    owner: { id: 'me', displayName: 'Ярослав' },
  });
  assert.deepEqual(
    result.map((item) => [item.id, item.displaySource]),
    [
      ['personal', 'personal'],
      ['duplicate', 'assigned'],
    ],
  );
});

test('canSendToApproval: свою задачу сдать можно', () => {
  assert.equal(canSendToApproval(asAssignedInboxBlockTask(assigned('t1')), 'me'), true);
});

test('canSendToApproval: чужую задачу сдать нельзя', () => {
  // «Сдать работу за другого» — не то действие, которое отдаётся жесту.
  const t = assigned('t2', {
    assignee: { userId: 'other', displayName: 'Коллега', avatarUrl: null },
  });
  assert.equal(canSendToApproval(asAssignedInboxBlockTask(t), 'me'), false);
});

test('canSendToApproval: задача уже на утверждении — повторно нельзя', () => {
  const t = assigned('t3', { status: 'pending_approval' });
  assert.equal(canSendToApproval(asAssignedInboxBlockTask(t), 'me'), false);
});

test('canSendToApproval: без текущего юзера цель недоступна', () => {
  assert.equal(canSendToApproval(asAssignedInboxBlockTask(assigned('t4')), null), false);
});

test('доска сотрудника (BUG D): личные и проектные задачи выходят вместе, без дублей с полкой «На утверждении»', () => {
  // Фокус-режим кормит доску одним источником (ListMemberTasksForLead), где вперемешку
  // личные (isInbox: true) и проектные задачи сотрудника — selectBoardTasks должен
  // разложить их в общий список колонок, но исключить всё, что уже показано на отдельных
  // полках («В работе» = 'manual', «На утверждении» = 'pending_approval').
  const personal = { ...assigned('personal-1'), isInbox: true, projectName: 'Личные' };
  const projectTask = {
    ...assigned('project-1', { projectId: 'proj-a' }),
    isInbox: false,
    projectName: 'Проект А',
  };
  const pendingApproval = assigned('pending-1', { status: 'pending_approval' });
  const inProgress = assigned('wip-1', { status: 'manual' });

  const board = selectBoardTasks(
    [personal, projectTask, pendingApproval, inProgress].map(asAssignedInboxBlockTask),
  );

  assert.deepEqual(
    board.map((t) => t.id).sort(),
    ['personal-1', 'project-1'],
  );
});

test('selectApprovalTasks: доска сотрудника видит его «На утверждении» даже из проекта, где руководитель не участник (BUG D, Important 2)', () => {
  // Задача сидит только в focusedTasks (ListMemberTasksForLead) — toMe/byMeDisplayTasks её
  // не видят вовсе, потому что membership-скоуплены на /assignees/mine|others. Раньше полка
  // читала только их и такая карточка пропадала отовсюду разом (доска её и так вырезает
  // как pending_approval). Регрессионный тест на фикс.
  const notMemberProjectTask = {
    ...assigned('pend-in-foreign-project', { projectId: 'proj-not-a-member', status: 'pending_approval' }),
    isInbox: false,
  };
  const result = selectApprovalTasks({
    toMeTasks: [],
    byMeDisplayTasks: [],
    focusedTasks: [asAssignedInboxBlockTask(notMemberProjectTask)],
    focusedMemberId: notMemberProjectTask.assignee.userId,
    isApprover: true,
  });
  assert.deepEqual(result.map((t) => t.id), ['pend-in-foreign-project']);
});

test('selectApprovalTasks: вне фокус-режима approver видит очередь по обоим направлениям, исполнитель — только свою', () => {
  const mine = assigned('mine-pending', { status: 'pending_approval' });
  const other = {
    ...assigned('other-pending', { status: 'pending_approval' }),
    assignee: { userId: 'colleague', displayName: 'Коллега', avatarUrl: null },
  };
  const approverView = selectApprovalTasks({
    toMeTasks: [asAssignedInboxBlockTask(mine)],
    byMeDisplayTasks: [asAssignedInboxBlockTask(other)],
    focusedTasks: [],
    focusedMemberId: null,
    isApprover: true,
  });
  assert.deepEqual(approverView.map((t) => t.id).sort(), ['mine-pending', 'other-pending']);

  const executorView = selectApprovalTasks({
    toMeTasks: [asAssignedInboxBlockTask(mine)],
    byMeDisplayTasks: [asAssignedInboxBlockTask(other)],
    focusedTasks: [],
    focusedMemberId: null,
    isApprover: false,
  });
  assert.deepEqual(executorView.map((t) => t.id), ['mine-pending']);
});

test('canOpenMemberBoard: только team-пространство и роль lead/owner (Important 1 — регрессия в дефолт-хабе)', () => {
  assert.equal(canOpenMemberBoard(null), false);
  assert.equal(canOpenMemberBoard({ kind: 'team', role: 'lead' }), true);
  assert.equal(canOpenMemberBoard({ kind: 'team', role: 'owner' }), true);
  assert.equal(canOpenMemberBoard({ kind: 'team', role: 'editor' }), false);
  assert.equal(canOpenMemberBoard({ kind: 'team', role: 'viewer' }), false);
  // В личном дефолт-хабе владелец формально 'owner', но ListMemberTasksForLead скоупит
  // строго по ws.id этого хаба, куда коллеги не входят (кубики там — из ВСЕХ общих
  // пространств) — жест должен быть выключен, а не бить 404 на каждый клик.
  assert.equal(canOpenMemberBoard({ kind: 'default', role: 'owner' }), false);
});

test('canSendToApproval: личная inbox-задача — сервер не требует приёмки, гейт закрыт', () => {
  // project.isInbox: сервер (TaskApprovalService.requiresApproval) намеренно не требует
  // приёмки — «свою задачу утверждать не у кого». Явный статус обходит серверную подмену,
  // поэтому клиент должен отказать сам, до отправки запроса.
  const t = { ...assigned('t5'), isInbox: true };
  assert.equal(canSendToApproval(asAssignedInboxBlockTask(t), 'me'), false);
});
