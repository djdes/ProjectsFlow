import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task, TaskStatus } from '../../domain/task/Task.js';
import type { Project } from '../../domain/project/Project.js';
import type { WorkspaceMember, WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
import { WorkspaceNotFoundError, NotWorkspaceLeadError } from '../../domain/workspace/errors.js';
import { ListMemberTasksForLead } from './ListMemberTasksForLead.js';

function task(id: string, projectId: string, assigneeUserId: string, status: TaskStatus = 'todo'): Task {
  return {
    id,
    projectId,
    createdBy: assigneeUserId,
    creator: null,
    assignee: { userId: assigneeUserId, displayName: assigneeUserId, avatarUrl: null },
    description: `Задача ${id}`,
    icon: null,
    cover: null,
    coverPosition: 50,
    status,
    statusBeforeDone: null,
    position: 1024,
    ralphMode: 'normal',
    deadline: null,
    startDate: null,
    parentTaskId: null,
    priority: null,
    deletedAt: null,
    deletedBy: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ralphCancelRequestedAt: null,
    ralphCancelRequestedBy: null,
  } as Task;
}

function project(input: {
  id: string;
  workspaceId: string;
  ownerId: string;
  name: string;
  isInbox?: boolean;
}): Project {
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    ownerId: input.ownerId,
    name: input.name,
    icon: null,
    status: 'active',
    gitRepoUrl: null,
    kbRepoFullName: null,
    kbKind: 'none',
    financeVisibility: 'owner',
    dispatcherUserId: null,
    multiTaskWorker: false,
    isInbox: input.isInbox ?? false,
    description: null,
    coverUrl: null,
    coverPosition: 50,
    publicSlug: null,
    isPublic: false,
    publicIndexing: false,
    publicAppearance: {
      accentColor: '#2383e2',
      showCover: true,
      showIcon: true,
      showDescription: true,
      showTaskMeta: true,
    },
    appRepoFullName: null,
    siteSlug: null,
    createdAt: new Date(0),
  } as Project;
}

function member(role: WorkspaceRole): WorkspaceMember {
  return {
    workspaceId: 'ws-team',
    userId: 'irrelevant',
    role,
    displayName: 'irrelevant',
    email: 'irrelevant@example.com',
    avatarUrl: null,
  } as WorkspaceMember;
}

type Setup = {
  callerRole: WorkspaceRole | null;
  memberRole: WorkspaceRole | null;
  projects: Project[];
  tasks: Task[];
  // роль caller'а в конкретных именованных (не-inbox) проектах, если он там участник
  callerProjectRoles?: Record<string, 'viewer' | 'editor' | 'lead' | 'owner'>;
  activeWorkspace?: { id: string; kind: 'default' | 'team' } | null;
};

function makeList(input: Setup): {
  list: ListMemberTasksForLead;
  findForProjectCalls: string[];
} {
  const activeWorkspace =
    input.activeWorkspace === undefined ? { id: 'ws-team', kind: 'team' as const } : input.activeWorkspace;
  const findForProjectCalls: string[] = [];
  const list = new ListMemberTasksForLead({
    projects: {
      getById: async (id: string) => input.projects.find((p) => p.id === id) ?? null,
    } as never,
    members: {
      findForProject: async (projectId: string, _userId: string) => {
        findForProjectCalls.push(projectId);
        const role = input.callerProjectRoles?.[projectId];
        return role ? { role } : null;
      },
    } as never,
    workspaces: {
      getMembership: async (_wsId: string, userId: string) => {
        if (userId === 'lead') return input.callerRole ? member(input.callerRole) : null;
        if (userId === 'bob') return input.memberRole ? member(input.memberRole) : null;
        return null;
      },
    } as never,
    tasks: {
      listAssignedToInWorkspace: async (userId: string, _wsId: string) =>
        input.tasks.filter((t) => t.assignee.userId === userId),
    } as never,
    taskCommits: { countsByTasks: async () => new Map() } as never,
    attachments: { countsByTasks: async () => new Map() } as never,
    comments: { countsByTasks: async () => new Map() } as never,
    resolveActiveWorkspace: async () => activeWorkspace,
    users: {
      getById: async (id: string) => ({ id, displayName: id === 'bob' ? 'Боб' : id }),
    } as never,
  });
  return { list, findForProjectCalls };
}

test('lead sees member tasks across the whole workspace, including projects they are not a member of', async () => {
  const { list } = makeList({
    callerRole: 'lead',
    memberRole: 'editor',
    projects: [
      project({ id: 'bob-inbox', workspaceId: 'ws-team', ownerId: 'bob', name: 'Входящие', isInbox: true }),
      project({ id: 'proj-a', workspaceId: 'ws-team', ownerId: 'someone-else', name: 'Проект А' }),
    ],
    tasks: [task('t1', 'bob-inbox', 'bob'), task('t2', 'proj-a', 'bob')],
    // caller (lead) не состоит в proj-a вовсе.
    callerProjectRoles: {},
  });

  const items = await list.execute('lead', 'bob');
  assert.deepEqual(items.map((i) => i.task.id).sort(), ['t1', 't2']);
  const byId = new Map(items.map((i) => [i.task.id, i]));
  assert.equal(byId.get('t1')!.isInbox, true);
  assert.equal(byId.get('t1')!.canModify, true, 'личные задачи модерируемы любым со-участником пространства');
  assert.equal(byId.get('t2')!.isInbox, false);
  assert.equal(
    byId.get('t2')!.canModify,
    false,
    'руководитель не участник proj-a — карточка read-only',
  );
});

test('caller who is a project member gets canModify per their real project role', async () => {
  const { list } = makeList({
    callerRole: 'lead',
    memberRole: 'editor',
    projects: [project({ id: 'proj-a', workspaceId: 'ws-team', ownerId: 'owner-x', name: 'Проект А' })],
    tasks: [task('t1', 'proj-a', 'bob')],
    callerProjectRoles: { 'proj-a': 'editor' },
  });

  const items = await list.execute('lead', 'bob');
  assert.equal(items[0]!.canModify, true);
});

test('a non-lead caller (editor/viewer) is rejected even for a real workspace member', async () => {
  const { list } = makeList({
    callerRole: 'editor',
    memberRole: 'editor',
    projects: [project({ id: 'bob-inbox', workspaceId: 'ws-team', ownerId: 'bob', name: 'Входящие', isInbox: true })],
    tasks: [task('t1', 'bob-inbox', 'bob')],
  });

  await assert.rejects(() => list.execute('lead', 'bob'), NotWorkspaceLeadError);
});

test('owner (not just lead) is allowed', async () => {
  const { list } = makeList({
    callerRole: 'owner',
    memberRole: 'viewer',
    projects: [project({ id: 'bob-inbox', workspaceId: 'ws-team', ownerId: 'bob', name: 'Входящие', isInbox: true })],
    tasks: [task('t1', 'bob-inbox', 'bob')],
  });

  const items = await list.execute('lead', 'bob');
  assert.deepEqual(items.map((i) => i.task.id), ['t1']);
});

test('caller with no membership at all in the active workspace is rejected', async () => {
  const { list } = makeList({
    callerRole: null,
    memberRole: 'editor',
    projects: [],
    tasks: [],
  });

  await assert.rejects(() => list.execute('lead', 'bob'), WorkspaceNotFoundError);
});

test('memberId who is not a member of the SAME workspace is rejected (404, not an empty list)', async () => {
  const { list } = makeList({
    callerRole: 'lead',
    memberRole: null, // 'bob' исключён из пространства
    projects: [project({ id: 'bob-inbox', workspaceId: 'ws-team', ownerId: 'bob', name: 'Входящие', isInbox: true })],
    tasks: [task('t1', 'bob-inbox', 'bob')],
  });

  await assert.rejects(() => list.execute('lead', 'bob'), WorkspaceNotFoundError);
});

test('no active workspace for the caller is rejected', async () => {
  const { list } = makeList({
    callerRole: 'lead',
    memberRole: 'editor',
    projects: [],
    tasks: [],
    activeWorkspace: null,
  });

  await assert.rejects(() => list.execute('lead', 'bob'), WorkspaceNotFoundError);
});

test('completed ("done") tasks are excluded', async () => {
  const { list } = makeList({
    callerRole: 'lead',
    memberRole: 'editor',
    projects: [project({ id: 'bob-inbox', workspaceId: 'ws-team', ownerId: 'bob', name: 'Входящие', isInbox: true })],
    tasks: [task('t1', 'bob-inbox', 'bob', 'todo'), task('t2', 'bob-inbox', 'bob', 'done')],
  });

  const items = await list.execute('lead', 'bob');
  assert.deepEqual(items.map((i) => i.task.id), ['t1']);
});

test('inboxOwner name resolves to the REAL project owner, not always the focused member (delegated-into-colleague-inbox case)', async () => {
  // bob получил задачу в личных входящих carol (carol делегировала ему) — колонка должна
  // подписаться «Личные · carol», а не именем bob (регрессия, которую ловит этот тест).
  const { list } = makeList({
    callerRole: 'lead',
    memberRole: 'editor',
    projects: [
      project({ id: 'carol-inbox', workspaceId: 'ws-team', ownerId: 'carol', name: 'Входящие', isInbox: true }),
    ],
    tasks: [task('t1', 'carol-inbox', 'bob')],
  });

  const items = await list.execute('lead', 'bob');
  assert.equal(items[0]!.inboxOwner?.userId, 'carol');
  assert.equal(items[0]!.inboxOwner?.displayName, 'carol');
});

test('other assignees in the same workspace are not leaked into the member board', async () => {
  const { list } = makeList({
    callerRole: 'lead',
    memberRole: 'editor',
    projects: [project({ id: 'bob-inbox', workspaceId: 'ws-team', ownerId: 'bob', name: 'Входящие', isInbox: true })],
    tasks: [task('t1', 'bob-inbox', 'bob'), task('t2', 'bob-inbox', 'carol')],
  });

  const items = await list.execute('lead', 'bob');
  assert.deepEqual(items.map((i) => i.task.id), ['t1']);
});
