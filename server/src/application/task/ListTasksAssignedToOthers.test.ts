import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../../domain/task/Task.js';
import { ListTasksAssignedToOthers } from './ListTasksAssignedToOthers.js';

function task(id: string, projectId: string, assigneeUserId: string): Task {
  return {
    id,
    projectId,
    createdBy: assigneeUserId,
    assignee: { userId: assigneeUserId, displayName: assigneeUserId, avatarUrl: null },
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
  } as Task;
}

type Proj = { id: string; name: string; isInbox: boolean; role: 'owner' | 'editor' | 'viewer' };

function makeList(input: {
  hubProjects: Proj[];
  workspaceProjects?: Proj[];
  tasksByProject: Record<string, Task[]>;
  activeWorkspace?: { id: string; kind: 'default' | 'team' } | null;
}): { list: ListTasksAssignedToOthers; askedWorkspace: string[] } {
  const askedWorkspace: string[] = [];
  const activeWorkspace =
    input.activeWorkspace === undefined ? { id: 'ws', kind: 'default' as const } : input.activeWorkspace;
  const list = new ListTasksAssignedToOthers({
    members: {
      listProjectsForUser: async () => input.hubProjects,
      listProjectsForUserInWorkspace: async (_userId: string, workspaceId: string) => {
        askedWorkspace.push(workspaceId);
        return input.workspaceProjects ?? [];
      },
    } as never,
    tasks: {
      listByProject: async (projectId: string) => input.tasksByProject[projectId] ?? [],
    } as never,
    taskCommits: { countsByTasks: async () => new Map() } as never,
    attachments: { countsByTasks: async () => new Map() } as never,
    comments: { countsByTasks: async () => new Map() } as never,
    resolveActiveWorkspace: async () => activeWorkspace,
  });
  return { list, askedWorkspace };
}

test('default hub aggregates other-assignee tasks across all projects', async () => {
  const { list, askedWorkspace } = makeList({
    hubProjects: [{ id: 'p1', name: 'Проект', isInbox: false, role: 'editor' }],
    tasksByProject: { p1: [task('t1', 'p1', 'bob'), task('t2', 'p1', 'me')] },
  });

  const items = await list.execute('me');
  // Задача bob видна, своя (me) — нет: это вкладка «за другими».
  assert.deepEqual(items.map((i) => i.task.id), ['t1']);
  // Дефолт-хаб не скоупит по конкретному пространству.
  assert.deepEqual(askedWorkspace, []);
});

test('team workspace only looks at that workspace projects', async () => {
  const { list, askedWorkspace } = makeList({
    // Хаб содержал бы p-other, но активно team-пространство → берём только его проекты.
    hubProjects: [{ id: 'p-other', name: 'Чужой', isInbox: false, role: 'editor' }],
    workspaceProjects: [{ id: 'p-team', name: 'Командный', isInbox: false, role: 'editor' }],
    tasksByProject: {
      'p-other': [task('t1', 'p-other', 'bob')],
      'p-team': [task('t2', 'p-team', 'carol')],
    },
    activeWorkspace: { id: 'ws-team', kind: 'team' },
  });

  const items = await list.execute('me');
  assert.deepEqual(items.map((i) => i.task.id), ['t2']);
  assert.deepEqual(askedWorkspace, ['ws-team']);
});

test('no active workspace yields an empty list', async () => {
  const { list } = makeList({
    hubProjects: [{ id: 'p1', name: 'Проект', isInbox: false, role: 'editor' }],
    tasksByProject: { p1: [task('t1', 'p1', 'bob')] },
    activeWorkspace: null,
  });

  assert.deepEqual(await list.execute('me'), []);
});
