import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../../domain/task/Task.js';
import type { SharedUser } from '../project/ProjectMemberRepository.js';
import { ListPersonalTasksOfColleagues } from './ListPersonalTasksOfColleagues.js';

function task(id: string, projectId: string, assigneeUserId: string): Task {
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
}): { list: ListPersonalTasksOfColleagues; askedOwners: string[][] } {
  const askedOwners: string[][] = [];
  const list = new ListPersonalTasksOfColleagues({
    members: {
      listSharedUsers: async (): Promise<SharedUser[]> =>
        input.colleagues.map((id) => ({
          id,
          displayName: id,
          email: `${id}@example.com`,
          avatarUrl: null,
        })),
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
  });
  return { list, askedOwners };
}

test('colleague personal inbox tasks are returned with inbox context', async () => {
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
  assert.equal(items[0]!.canModify, false);
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
