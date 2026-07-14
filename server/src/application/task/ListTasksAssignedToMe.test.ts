import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../../domain/task/Task.js';
import { ListTasksAssignedToMe } from './ListTasksAssignedToMe.js';

function task(id: string, projectId: string): Task {
  return {
    id,
    projectId,
    createdBy: 'creator',
    assignee: { userId: 'me', displayName: 'Я', avatarUrl: null },
    description: `Задача ${id}`,
    icon: null,
    cover: null,
    coverPosition: 50,
    status: 'todo',
    statusBeforeDone: null,
    position: 1024,
    ralphMode: 'normal',
    deadline: null,
    startDate: null,
    parentTaskId: null,
    priority: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ralphCancelRequestedAt: null,
    ralphCancelRequestedBy: null,
  };
}

function makeList(input: {
  tasks: Task[];
  projects: Record<string, { id: string; name: string; isInbox: boolean }>;
  memberships?: Record<string, boolean>;
}): ListTasksAssignedToMe {
  return new ListTasksAssignedToMe({
    tasks: { listAssignedTo: async () => input.tasks } as never,
    projects: {
      getById: async (id: string) => input.projects[id] ?? null,
    } as never,
    members: {
      findForProject: async (projectId: string) =>
        input.memberships?.[projectId] === false
          ? null
          : { projectId, userId: 'me', role: 'viewer' },
    } as never,
    taskCommits: { countsByTasks: async () => new Map([['t1', 2]]) } as never,
    attachments: { countsByTasks: async () => new Map([['t1', 3]]) } as never,
    comments: { countsByTasks: async () => new Map([['t1', 4]]) } as never,
  });
}

test('current assignee sees a named-project task and can modify it even as viewer', async () => {
  const list = makeList({
    tasks: [task('t1', 'p1')],
    projects: { p1: { id: 'p1', name: 'Проект', isInbox: false } },
  });

  const items = await list.execute('me');
  assert.equal(items.length, 1);
  assert.equal(items[0]!.canModify, true);
  assert.equal(items[0]!.commitCount, 2);
  assert.equal(items[0]!.attachmentCount, 3);
  assert.equal(items[0]!.commentCount, 4);
});

test('assignment does not preserve access after removal from a named project', async () => {
  const list = makeList({
    tasks: [task('t1', 'p1')],
    projects: { p1: { id: 'p1', name: 'Проект', isInbox: false } },
    memberships: { p1: false },
  });

  assert.deepEqual(await list.execute('me'), []);
});

test('current assignee sees an Inbox task without project membership', async () => {
  const list = makeList({
    tasks: [task('t1', 'inbox')],
    projects: { inbox: { id: 'inbox', name: 'Входящие', isInbox: true } },
    memberships: { inbox: false },
  });

  const items = await list.execute('me');
  assert.equal(items.length, 1);
  assert.equal(items[0]!.isInbox, true);
  assert.equal(items[0]!.canModify, true);
});
