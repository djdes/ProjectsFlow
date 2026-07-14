import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AssignedTask } from '@/domain/task/AssignedTask';
import type { Task } from '@/domain/task/Task';
import type { TaskDelegation } from '@/domain/task/TaskDelegation';
import {
  buildToMeInboxBlockTasks,
  isPersonalInboxBlockTask,
} from './inboxBlockTasks';

const NOW = new Date('2026-07-14T09:00:00.000Z');

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    projectId: 'inbox-me',
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
    delegation: null,
    ...overrides,
  };
}

function assigned(id: string): AssignedTask {
  const delegation: TaskDelegation = {
    id: `d-${id}`,
    taskId: id,
    delegateUserId: 'me',
    delegateDisplayName: 'Ярослав',
    creatorUserId: 'other',
    creatorDisplayName: 'Олег',
    status: 'accepted',
    createdAt: NOW,
    respondedAt: NOW,
  };
  return {
    ...task(id, { projectId: 'inbox-other', delegation }),
    delegation,
    projectName: 'Входящие',
    isInbox: true,
    canModify: true,
  };
}

test('зеркалит задачи нижней доски как личные карточки без фиктивной делегации', () => {
  const result = buildToMeInboxBlockTasks({
    delegatedTasks: [],
    boardTasks: [task('personal')],
    inboxProjectId: 'inbox-me',
    owner: { id: 'me', displayName: 'Ярослав' },
  });

  assert.equal(result.length, 1);
  const mirror = result[0];
  assert.ok(mirror && isPersonalInboxBlockTask(mirror));
  assert.equal(mirror.delegation, null);
  assert.equal(mirror.personalOwnerDisplayName, 'Ярослав');
  assert.equal(mirror.id, 'personal');
});

test('не зеркалит чужие, делегированные и уже присутствующие сверху задачи', () => {
  const duplicate = assigned('duplicate');
  const activeDelegation = assigned('delegated').delegation;
  const result = buildToMeInboxBlockTasks({
    delegatedTasks: [duplicate, duplicate],
    boardTasks: [
      task('duplicate'),
      task('foreign', { projectId: 'inbox-other' }),
      task('delegated', { delegation: activeDelegation }),
      task('personal'),
    ],
    inboxProjectId: 'inbox-me',
    owner: { id: 'me', displayName: 'Ярослав' },
  });

  assert.deepEqual(
    result.map((item) => [item.id, item.displaySource]),
    [
      ['personal', 'personal'],
      ['duplicate', 'delegation'],
    ],
  );
});
