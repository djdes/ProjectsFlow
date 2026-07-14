import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AssignedTask } from '@/domain/task/AssignedTask';
import type { Task } from '@/domain/task/Task';
import { buildToMeInboxBlockTasks, isPersonalInboxBlockTask } from './inboxBlockTasks';

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
    ...overrides,
  };
}

function assigned(id: string): AssignedTask {
  return {
    ...task(id, { projectId: 'inbox-other' }),
    projectName: 'Входящие',
    isInbox: true,
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
