import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AssignedTask } from '@/domain/task/AssignedTask';
import type { Task } from '@/domain/task/Task';
import {
  asAssignedInboxBlockTask,
  buildToMeInboxBlockTasks,
  canSendToApproval,
  isPersonalInboxBlockTask,
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

test('canSendToApproval: личная inbox-задача — сервер не требует приёмки, гейт закрыт', () => {
  // project.isInbox: сервер (TaskApprovalService.requiresApproval) намеренно не требует
  // приёмки — «свою задачу утверждать не у кого». Явный статус обходит серверную подмену,
  // поэтому клиент должен отказать сам, до отправки запроса.
  const t = { ...assigned('t5'), isInbox: true };
  assert.equal(canSendToApproval(asAssignedInboxBlockTask(t), 'me'), false);
});
