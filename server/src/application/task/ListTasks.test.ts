import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../../domain/task/Task.js';
import { ListTasks } from './ListTasks.js';

function task(id: string, projectId: string, assigneeUserId: string): Task {
  return {
    id,
    projectId,
    createdBy: 'creator',
    assignee: { userId: assigneeUserId, displayName: 'Кто-то', avatarUrl: null },
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

type ProjectStub = { id: string; name: string; isInbox: boolean; ownerId: string };

function makeList(input: {
  boardTasks: Task[];
  projects: Record<string, ProjectStub>;
}): ListTasks {
  return new ListTasks({
    tasks: {
      listByProject: async () => input.boardTasks,
    } as never,
    projects: {
      getById: async (id: string) => input.projects[id] ?? null,
    } as never,
    members: {
      findForProject: async (projectId: string, userId: string) => ({
        projectId,
        userId,
        role: 'owner',
      }),
    } as never,
    taskCommits: { countsByTasks: async () => new Map([['t1', 2]]) } as never,
    attachments: { countsByTasks: async () => new Map() } as never,
    comments: { countsByTasks: async () => new Map() } as never,
  });
}

const myInbox: ProjectStub = { id: 'inbox-me', name: 'inbox:me', isInbox: true, ownerId: 'me' };

// Личная задача всегда лежит во входящих своего ответственного (владение переезжает за
// назначением, см. ChangeTaskAssignee), поэтому доска отдаёт строго свои физические задачи
// и ничего не подмешивает — ни чужого себе, ни своего чужим.
test('доска отдаёт строго физические задачи проекта', async () => {
  const list = makeList({
    boardTasks: [task('t1', 'inbox-me', 'me'), task('t2', 'inbox-me', 'me')],
    projects: { 'inbox-me': myInbox },
  });

  const items = await list.execute('inbox-me', 'me');
  assert.deepEqual(
    items.map((t) => t.id),
    ['t1', 't2'],
  );
});

test('счётчики проставляются по задачам доски', async () => {
  const list = makeList({
    boardTasks: [task('t1', 'inbox-me', 'me')],
    projects: { 'inbox-me': myInbox },
  });

  const items = await list.execute('inbox-me', 'me');
  assert.equal(items[0]?.commitCount, 2);
  assert.equal(items[0]?.attachmentCount, 0);
});
