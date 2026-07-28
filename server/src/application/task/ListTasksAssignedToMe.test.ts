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
  // По умолчанию — дефолт-хаб (агрегирует всё): существующие кейсы поведения не меняют.
  activeWorkspace?: { id: string; kind: 'default' | 'team' } | null;
  // Что вернёт listAssignedToInWorkspace для team-пространства.
  workspaceTasks?: Task[];
}): ListTasksAssignedToMe {
  const activeWorkspace =
    input.activeWorkspace === undefined ? { id: 'ws', kind: 'default' as const } : input.activeWorkspace;
  return new ListTasksAssignedToMe({
    tasks: {
      listAssignedTo: async () => input.tasks,
      listAssignedToInWorkspace: async () => input.workspaceTasks ?? [],
    } as never,
    projects: {
      getById: async (id: string) => input.projects[id] ?? null,
    } as never,
    users: {
      getById: async (id: string) => ({ id, displayName: `Юзер ${id}` }),
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
    resolveActiveWorkspace: async () => activeWorkspace,
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

test('team workspace scopes to that workspace tasks only (not the hub aggregate)', async () => {
  const list = makeList({
    // Хаб-агрегат содержит t1, но активно team-пространство: должен вернуться только t2.
    tasks: [task('t1', 'p-other')],
    workspaceTasks: [task('t2', 'p-team')],
    projects: {
      'p-other': { id: 'p-other', name: 'Чужой', isInbox: false },
      'p-team': { id: 'p-team', name: 'Командный', isInbox: false },
    },
    activeWorkspace: { id: 'ws-team', kind: 'team' },
  });

  const items = await list.execute('me');
  assert.deepEqual(items.map((i) => i.task.id), ['t2']);
});

test('no active workspace yields an empty list', async () => {
  const list = makeList({
    tasks: [task('t1', 'p1')],
    projects: { p1: { id: 'p1', name: 'Проект', isInbox: false } },
    activeWorkspace: null,
  });

  assert.deepEqual(await list.execute('me'), []);
});
