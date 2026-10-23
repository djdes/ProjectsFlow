import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task, TaskStatus } from '../../domain/task/Task.js';
import type { Project } from '../../domain/project/Project.js';
import type { WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
import { ListApprovalQueue } from './ListApprovalQueue.js';

function task(id: string, projectId: string, input: { assignee: string; createdBy: string; status?: TaskStatus }): Task {
  return {
    id,
    projectId,
    createdBy: input.createdBy,
    creator: null,
    assignee: { userId: input.assignee, displayName: input.assignee, avatarUrl: null },
    description: `Задача ${id}`,
    status: input.status ?? 'pending_approval',
    statusBeforeDone: null,
    position: 1024,
    deletedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  } as Task;
}

function project(id: string, input: { workspaceId?: string; ownerId?: string; isInbox?: boolean } = {}): Project {
  return {
    id,
    workspaceId: input.workspaceId ?? 'ws-team',
    ownerId: input.ownerId ?? 'owner',
    name: input.isInbox ? `inbox:${input.ownerId}` : `Проект ${id}`,
    isInbox: input.isInbox ?? false,
  } as Project;
}

function makeQueue(input: {
  callerRole: WorkspaceRole | null;
  projects: Project[];
  tasks: Task[];
  // роль caller'а в именованных проектах; нет записи — не участник
  projectRoles?: Record<string, 'viewer' | 'editor' | 'lead' | 'owner'>;
  hidden?: string[];
  activeWorkspace?: { id: string; kind: 'default' | 'team' } | null;
}): ListApprovalQueue {
  const activeWorkspace = input.activeWorkspace === undefined ? { id: 'ws-team', kind: 'team' as const } : input.activeWorkspace;
  return new ListApprovalQueue({
    projects: { getById: async (id: string) => input.projects.find((p) => p.id === id) ?? null } as never,
    members: {
      listApproverUserIdsForProject: async () => input.callerRole === 'lead' || input.callerRole === 'owner' ? ['lead'] : [],
      findForProject: async (projectId: string) => {
        const role = input.projectRoles?.[projectId];
        return role ? { role } : null;
      },
      isProjectHidden: async (projectId: string) => input.hidden?.includes(projectId) ?? false,
    } as never,
    workspaces: {
      getMembership: async (_wsId: string, userId: string) =>
        userId === 'lead' && input.callerRole ? { role: input.callerRole } : null,
    } as never,
    tasks: {
      listByStatusInWorkspace: async (_wsId: string, status: TaskStatus) =>
        input.tasks.filter((t) => t.status === status),
    } as never,
    taskCommits: { countsByTasks: async () => new Map() } as never,
    attachments: { countsByTasks: async () => new Map() } as never,
    comments: { countsByTasks: async () => new Map() } as never,
    resolveActiveWorkspace: async () => activeWorkspace,
    users: { getById: async (id: string) => ({ id, displayName: id === 'benzin' ? 'benzin' : id }) } as never,
  });
}

test('руководитель видит личную задачу сотрудника на утверждении, даже если поставил её не он', async () => {
  // Инцидент 14.10.2026: задачу поставил владелец пространства во «Входящие» сотрудника,
  // сотрудник сдал её — у руководителя полка «На утверждении» была пустой.
  const queue = makeQueue({
    callerRole: 'lead',
    projects: [project('benzin-inbox', { ownerId: 'benzin', isInbox: true })],
    tasks: [task('t1', 'benzin-inbox', { assignee: 'benzin', createdBy: 'owner' })],
  });

  const items = await queue.execute('lead');
  assert.deepEqual(items.map((i) => i.task.id), ['t1']);
  assert.equal(items[0]!.isInbox, true);
  assert.deepEqual(items[0]!.inboxOwner, { userId: 'benzin', displayName: 'benzin' });
  assert.equal(items[0]!.canModify, true);
});

test('задачи именованных проектов — только где руководитель вправе двигать задачи', async () => {
  const queue = makeQueue({
    callerRole: 'owner',
    projects: [project('site'), project('docs'), project('closed')],
    tasks: [
      task('t-site', 'site', { assignee: 'bob', createdBy: 'bob' }),
      task('t-docs', 'docs', { assignee: 'bob', createdBy: 'bob' }),
      task('t-closed', 'closed', { assignee: 'bob', createdBy: 'bob' }),
    ],
    projectRoles: { site: 'lead', docs: 'viewer' },
  });

  const items = await queue.execute('lead');
  assert.deepEqual(items.map((i) => i.task.id), ['t-site']);
});

test('чужое пространство и скрытый проект в очередь не попадают', async () => {
  const queue = makeQueue({
    callerRole: 'lead',
    projects: [
      project('foreign', { workspaceId: 'ws-other' }),
      project('secret'),
      project('bob-inbox', { ownerId: 'bob', isInbox: true }),
    ],
    tasks: [
      task('t-foreign', 'foreign', { assignee: 'bob', createdBy: 'bob' }),
      task('t-secret', 'secret', { assignee: 'bob', createdBy: 'bob' }),
      task('t-inbox', 'bob-inbox', { assignee: 'bob', createdBy: 'bob' }),
    ],
    projectRoles: { foreign: 'editor', secret: 'editor' },
    hidden: ['secret'],
  });

  const items = await queue.execute('lead');
  assert.deepEqual(items.map((i) => i.task.id), ['t-inbox']);
});

test('не руководитель и не владелец — очередь пустая', async () => {
  for (const role of ['editor', 'viewer', null] as const) {
    const queue = makeQueue({
      callerRole: role,
      projects: [project('bob-inbox', { ownerId: 'bob', isInbox: true })],
      tasks: [task('t1', 'bob-inbox', { assignee: 'bob', createdBy: 'bob' })],
    });
    assert.deepEqual(await queue.execute('lead'), [], `роль ${role}`);
  }
});

test('нет активного пространства — очередь пустая', async () => {
  const queue = makeQueue({
    callerRole: 'lead',
    activeWorkspace: null,
    projects: [project('bob-inbox', { ownerId: 'bob', isInbox: true })],
    tasks: [task('t1', 'bob-inbox', { assignee: 'bob', createdBy: 'bob' })],
  });
  assert.deepEqual(await queue.execute('lead'), []);
});
