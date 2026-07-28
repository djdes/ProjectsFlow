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
  // Задачи, физически лежащие в запрашиваемом проекте.
  boardTasks: Task[];
  // Что вернёт listAssignedTo(userId) — задачи со всех проектов.
  assignedTasks?: Task[];
  projects: Record<string, ProjectStub>;
}): ListTasks {
  return new ListTasks({
    tasks: {
      listByProject: async () => input.boardTasks,
      listAssignedTo: async () => input.assignedTasks ?? [],
    } as never,
    projects: {
      getById: async (id: string) => input.projects[id] ?? null,
    } as never,
    users: {
      getById: async (id: string) => ({ id, displayName: id === 'other' ? 'Денис' : 'Я' }),
    } as never,
    members: {
      findForProject: async (projectId: string, userId: string) => ({
        projectId,
        userId,
        role: 'owner',
      }),
    } as never,
    taskCommits: { countsByTasks: async () => new Map() } as never,
    attachments: { countsByTasks: async () => new Map() } as never,
    comments: { countsByTasks: async () => new Map() } as never,
  });
}

const myInbox: ProjectStub = { id: 'inbox-me', name: 'inbox:me', isInbox: true, ownerId: 'me' };
const foreignInbox: ProjectStub = {
  id: 'inbox-other',
  name: 'inbox:other',
  isInbox: true,
  ownerId: 'other',
};
const namedProject: ProjectStub = { id: 'p1', name: 'Проект', isInbox: false, ownerId: 'other' };

test('своя inbox-доска показывает задачу из чужих личных, где я ответственный', async () => {
  const list = makeList({
    boardTasks: [task('mine', 'inbox-me', 'me')],
    assignedTasks: [task('mine', 'inbox-me', 'me'), task('foreign', 'inbox-other', 'me')],
    projects: { 'inbox-me': myInbox, 'inbox-other': foreignInbox },
  });

  const items = await list.execute('inbox-me', 'me');
  assert.deepEqual(
    items.map((t) => t.id).sort(),
    ['foreign', 'mine'],
  );
  // Подмешанная задача честно подписана владельцем чужих входящих, своя — нет.
  assert.deepEqual(items.find((t) => t.id === 'foreign')?.inboxOwner, {
    userId: 'other',
    displayName: 'Денис',
  });
  assert.equal(items.find((t) => t.id === 'mine')?.inboxOwner, null);
});

test('задача именованного проекта на личную доску не подмешивается', async () => {
  const list = makeList({
    boardTasks: [],
    assignedTasks: [task('in-project', 'p1', 'me')],
    projects: { 'inbox-me': myInbox, p1: namedProject },
  });

  const items = await list.execute('inbox-me', 'me');
  assert.deepEqual(items, []);
});

test('доска именованного проекта возвращает строго свои задачи', async () => {
  const list = makeList({
    boardTasks: [task('own', 'p1', 'someone')],
    // Даже если человеку назначены чужие личные задачи — на доску проекта они не попадают.
    assignedTasks: [task('foreign', 'inbox-other', 'me')],
    projects: { p1: namedProject, 'inbox-other': foreignInbox },
  });

  const items = await list.execute('p1', 'me');
  assert.deepEqual(
    items.map((t) => t.id),
    ['own'],
  );
});

test('чужую inbox-доску своими назначенными задачами не засоряем', async () => {
  const list = makeList({
    boardTasks: [task('theirs', 'inbox-other', 'other')],
    assignedTasks: [task('foreign', 'inbox-other', 'me')],
    projects: { 'inbox-other': foreignInbox, 'inbox-me': myInbox },
  });

  // Запрашиваем ЧУЖОЙ inbox (доступ есть, напр. коллега по пространству): подмешивание
  // работает только для владельца доски, иначе мои задачи «протекли» бы к другому юзеру.
  const items = await list.execute('inbox-other', 'me');
  assert.deepEqual(
    items.map((t) => t.id),
    ['theirs'],
  );
});
