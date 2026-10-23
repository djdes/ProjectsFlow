import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task, TaskStatus } from '../../domain/task/Task.js';
import type { Project } from '../../domain/project/Project.js';
import type { TaskComment } from '../../domain/task/TaskComment.js';
import { ListTasksAwaitingMyReply } from './ListTasksAwaitingMyReply.js';

function task(id: string, projectId: string, status: TaskStatus = 'backlog'): Task {
  return {
    id,
    projectId,
    createdBy: 'worker',
    creator: null,
    assignee: { userId: 'worker', displayName: 'worker', avatarUrl: null },
    description: `Задача ${id}`,
    status,
    statusBeforeDone: null,
    position: 1024,
    deletedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  } as Task;
}

function project(id: string, workspaceId = 'ws-team'): Project {
  return { id, workspaceId, ownerId: 'owner', name: `Проект ${id}`, isInbox: false } as Project;
}

function comment(id: string, taskId: string, at: number, body = `Вопрос ${id}`): TaskComment {
  return { id, taskId, ownerUserId: 'worker', body, createdAt: new Date(at) } as TaskComment;
}

function makeList(input: { projects: Project[]; tasks: Task[]; comments: TaskComment[]; readable?: string[] }) {
  return new ListTasksAwaitingMyReply({
    projects: { getById: async (id: string) => input.projects.find((p) => p.id === id) ?? null } as never,
    members: {
      findForProject: async (projectId: string) =>
        (input.readable ?? input.projects.map((p) => p.id)).includes(projectId) ? { role: 'lead' } : null,
      isProjectHidden: async () => false,
    } as never,
    tasks: { getById: async (id: string) => input.tasks.find((t) => t.id === id) ?? null } as never,
    taskCommits: { countsByTasks: async () => new Map() } as never,
    attachments: { countsByTasks: async () => new Map() } as never,
    comments: {
      countsByTasks: async () => new Map(),
      // The repository returns newest first.
      listUnansweredAddressedTo: async () => [...input.comments].sort((a, b) => +b.createdAt - +a.createdAt),
    } as never,
    resolveActiveWorkspace: async () => ({ id: 'ws-team', kind: 'team' as const }),
    users: { getById: async (id: string) => ({ id, displayName: id === 'worker' ? 'Наталья' : id }) } as never,
  });
}

test('одна строка на задачу с последним адресованным вопросом и его автором', async () => {
  const list = makeList({
    projects: [project('p1')],
    tasks: [task('t1', 'p1')],
    comments: [comment('c-old', 't1', 1000), comment('c-new', 't1', 2000, 'Как  сделать\nоплату?')],
  });

  const items = await list.execute('lead');

  assert.equal(items.length, 1);
  assert.equal(items[0]!.task.id, 't1');
  assert.deepEqual(items[0]!.question, {
    commentId: 'c-new',
    authorUserId: 'worker',
    authorDisplayName: 'Наталья',
    excerpt: 'Как сделать оплату?',
    askedAt: new Date(2000),
  });
});

test('закрытые задачи, другое пространство и недоступные проекты не показываем', async () => {
  const list = makeList({
    projects: [project('p1'), project('p-other', 'ws-other'), project('p-closed')],
    tasks: [task('t-open', 'p1'), task('t-done', 'p1', 'done'), task('t-other', 'p-other'), task('t-hidden', 'p-closed')],
    comments: [
      comment('c1', 't-open', 1000),
      comment('c2', 't-done', 1000),
      comment('c3', 't-other', 1000),
      comment('c4', 't-hidden', 1000),
      comment('c5', 't-deleted', 1000),
    ],
    readable: ['p1', 'p-other'],
  });

  const items = await list.execute('lead');

  assert.deepEqual(items.map((i) => i.task.id), ['t-open']);
});
