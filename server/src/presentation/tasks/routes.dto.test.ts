import assert from 'node:assert/strict';
import test from 'node:test';
import type { Task } from '../../domain/task/Task.js';
import { toDto } from './routes.js';

test('task DTO: создатель отделён от единственного текущего ответственного', () => {
  const task: Task = {
    id: 'task-1',
    projectId: 'project-1',
    createdBy: 'denis-user-id',
    creator: {
      userId: 'denis-user-id',
      displayName: 'Денис',
      avatarUrl: '/avatars/denis.png',
    },
    assignee: {
      userId: 'current-assignee-id',
      displayName: 'Я',
      avatarUrl: null,
    },
    description: 'Задача, созданная Денисом и назначенная мне',
    icon: null,
    cover: null,
    coverPosition: 50,
    status: 'todo',
    statusBeforeDone: null,
    position: 1024,
    ralphMode: 'normal',
    ralphCancelRequestedAt: null,
    ralphCancelRequestedBy: null,
    ralphCancelRequestedByDisplayName: null,
    deadline: null,
    startDate: null,
    parentTaskId: null,
    priority: null,
    createdAt: new Date('2026-07-14T10:00:00.000Z'),
    updatedAt: new Date('2026-07-14T10:00:00.000Z'),
  };

  const dto = toDto(task);

  assert.equal('createdBy' in dto, false);
  assert.deepEqual(dto.creator, {
    userId: 'denis-user-id',
    displayName: 'Денис',
    avatarUrl: '/avatars/denis.png',
  });
  assert.deepEqual(dto.assignee, {
    userId: 'current-assignee-id',
    displayName: 'Я',
    avatarUrl: null,
  });
});
