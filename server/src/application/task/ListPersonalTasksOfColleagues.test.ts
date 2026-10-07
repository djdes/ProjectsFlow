import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../../domain/task/Task.js';
import type { SharedUser } from '../project/ProjectMemberRepository.js';
import { ListPersonalTasksOfColleagues } from './ListPersonalTasksOfColleagues.js';

// По умолчанию задачу поставил caller ('me') — это и есть видимое ему поручение коллеге.
function task(id: string, projectId: string, assigneeUserId: string, createdBy = 'me'): Task {
  return {
    id,
    projectId,
    createdBy,
    creator: null,
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
    deletedAt: null,
    deletedBy: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ralphCancelRequestedAt: null,
    ralphCancelRequestedBy: null,
  } as Task;
}

type Inbox = { id: string; ownerId: string; name: string };

function makeList(input: {
  colleagues: string[];
  inboxes: Inbox[];
  tasks: Task[];
  // По умолчанию — дефолт-хаб: существующие кейсы поведения не меняют.
  activeWorkspace?: { id: string; kind: 'default' | 'team' } | null;
  // Круг коллег, который отдаёт listSharedUsersInWorkspace для team-пространства.
  workspaceColleagues?: string[];
}): { list: ListPersonalTasksOfColleagues; askedOwners: string[][] } {
  const askedOwners: string[][] = [];
  const activeWorkspace =
    input.activeWorkspace === undefined ? { id: 'ws', kind: 'default' as const } : input.activeWorkspace;
  const toShared = (ids: string[]): SharedUser[] =>
    ids.map((id) => ({ id, displayName: id, email: `${id}@example.com`, avatarUrl: null }));
  const list = new ListPersonalTasksOfColleagues({
    members: {
      listSharedUsers: async (): Promise<SharedUser[]> => toShared(input.colleagues),
      listSharedUsersInWorkspace: async (): Promise<SharedUser[]> =>
        toShared(input.workspaceColleagues ?? []),
    } as never,
    projects: {
      listInboxesByOwners: async (ownerIds: readonly string[]) => {
        askedOwners.push([...ownerIds]);
        return input.inboxes
          .filter((p) => ownerIds.includes(p.ownerId))
          .map((p) => ({ ...p, isInbox: true }));
      },
    } as never,
    tasks: {
      listByProjects: async (projectIds: readonly string[]) =>
        input.tasks.filter((t) => projectIds.includes(t.projectId)),
    } as never,
    taskCommits: { countsByTasks: async () => new Map([['t1', 2]]) } as never,
    attachments: { countsByTasks: async () => new Map([['t1', 3]]) } as never,
    comments: { countsByTasks: async () => new Map([['t1', 4]]) } as never,
    resolveActiveWorkspace: async () => activeWorkspace,
  });
  return { list, askedOwners };
}

test('a task the caller put into a colleague inbox is returned with inbox context', async () => {
  const { list } = makeList({
    colleagues: ['bob'],
    inboxes: [{ id: 'bob-inbox', ownerId: 'bob', name: 'Входящие' }],
    tasks: [task('t1', 'bob-inbox', 'bob')],
  });

  const items = await list.execute('me');
  assert.equal(items.length, 1);
  assert.equal(items[0]!.projectId, 'bob-inbox');
  assert.equal(items[0]!.projectName, 'Входящие');
  assert.equal(items[0]!.isInbox, true);
  // Право на действие совпадает с правом на просмотр: поставил задачу — может двигать и удалять.
  assert.equal(items[0]!.canModify, true);
  assert.equal(items[0]!.commitCount, 2);
  assert.equal(items[0]!.attachmentCount, 3);
  assert.equal(items[0]!.commentCount, 4);
});

test('personal tasks of a non-colleague are never visible', async () => {
  // 'stranger' не в общих пространствах: его inbox существует и полон задач,
  // но в круг из listSharedUsers он не входит.
  const { list, askedOwners } = makeList({
    colleagues: ['bob'],
    inboxes: [
      { id: 'bob-inbox', ownerId: 'bob', name: 'Входящие' },
      { id: 'stranger-inbox', ownerId: 'stranger', name: 'Входящие' },
    ],
    tasks: [task('t1', 'bob-inbox', 'bob'), task('t2', 'stranger-inbox', 'stranger')],
  });

  const items = await list.execute('me');
  assert.deepEqual(items.map((i) => i.task.id), ['t1']);
  // Сервер вообще не спрашивает inbox постороннего.
  assert.deepEqual(askedOwners, [['bob']]);
});

test('no colleagues means no personal feed at all', async () => {
  const { list, askedOwners } = makeList({
    colleagues: [],
    inboxes: [{ id: 'stranger-inbox', ownerId: 'stranger', name: 'Входящие' }],
    tasks: [task('t1', 'stranger-inbox', 'stranger')],
  });

  assert.deepEqual(await list.execute('me'), []);
  assert.deepEqual(askedOwners, []);
});

test('tasks assigned back to the caller are skipped (they live in the "mine" tab)', async () => {
  const { list } = makeList({
    colleagues: ['bob'],
    inboxes: [{ id: 'bob-inbox', ownerId: 'bob', name: 'Входящие' }],
    tasks: [task('t1', 'bob-inbox', 'bob'), task('t2', 'bob-inbox', 'me')],
  });

  const items = await list.execute('me');
  assert.deepEqual(items.map((i) => i.task.id), ['t1']);
});

test('team workspace limits the colleague circle to co-members of that workspace', async () => {
  // Хаб знает и bob, и carol; но активно team-пространство, где со-участник только bob.
  const { list, askedOwners } = makeList({
    colleagues: ['bob', 'carol'],
    workspaceColleagues: ['bob'],
    activeWorkspace: { id: 'ws-team', kind: 'team' },
    inboxes: [
      { id: 'bob-inbox', ownerId: 'bob', name: 'Входящие' },
      { id: 'carol-inbox', ownerId: 'carol', name: 'Входящие' },
    ],
    tasks: [task('t1', 'bob-inbox', 'bob'), task('t2', 'carol-inbox', 'carol')],
  });

  const items = await list.execute('me');
  assert.deepEqual(items.map((i) => i.task.id), ['t1']);
  // Сервер не спрашивает inbox коллеги вне активного пространства.
  assert.deepEqual(askedOwners, [['bob']]);
});

test('no active workspace yields an empty personal feed', async () => {
  const { list, askedOwners } = makeList({
    colleagues: ['bob'],
    activeWorkspace: null,
    inboxes: [{ id: 'bob-inbox', ownerId: 'bob', name: 'Входящие' }],
    tasks: [task('t1', 'bob-inbox', 'bob')],
  });

  assert.deepEqual(await list.execute('me'), []);
  assert.deepEqual(askedOwners, []);
});

test("caller's own inbox is filtered out even if it leaks into the colleague circle", async () => {
  const { list } = makeList({
    colleagues: ['me', 'bob'],
    inboxes: [
      { id: 'my-inbox', ownerId: 'me', name: 'Входящие' },
      { id: 'bob-inbox', ownerId: 'bob', name: 'Входящие' },
    ],
    tasks: [task('t1', 'bob-inbox', 'bob'), task('t9', 'my-inbox', 'someone')],
  });

  const items = await list.execute('me');
  assert.deepEqual(items.map((i) => i.task.id), ['t1']);
});

// Главное правило: собственные личные задачи коллеги приватны — после приглашения в общее
// пространство они не должны всплывать во «Входящих» у всех остальных.
test("a colleague's own personal tasks are never visible", async () => {
  const { list } = makeList({
    colleagues: ['bob', 'carol'],
    inboxes: [{ id: 'bob-inbox', ownerId: 'bob', name: 'Входящие' }],
    tasks: [
      task('own', 'bob-inbox', 'bob', 'bob'),
      task('from-carol', 'bob-inbox', 'bob', 'carol'),
      task('from-me', 'bob-inbox', 'bob', 'me'),
    ],
  });

  const items = await list.execute('me');
  assert.deepEqual(items.map((i) => i.task.id), ['from-me']);
});
