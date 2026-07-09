import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GetPublicBoard, publicCoverUrl } from './GetPublicBoard.js';
import type { Project } from '../../domain/project/Project.js';
import type { Task } from '../../domain/task/Task.js';
import type { ProjectRepository } from './ProjectRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p1', ownerId: 'u1', name: 'Persona', icon: '🛏️', status: 'active',
    gitRepoUrl: null, kbRepoFullName: null, kbKind: 'none', financeVisibility: 'owner',
    dispatcherUserId: null, multiTaskWorker: false, isInbox: false,
    description: 'desc', coverUrl: 'gradient:sky', coverPosition: 50,
    publicSlug: 'cookie-opinion-k3f9q2', isPublic: true, publicIndexing: false,
    appRepoFullName: null,
    siteSlug: null,
    createdAt: new Date('2026-01-01'),
    ...over,
  };
}

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 't1', projectId: 'p1', createdBy: 'u1', description: 'Задача\nтело',
    icon: null, cover: null, coverPosition: 50, status: 'todo', statusBeforeDone: null,
    position: 1, ralphMode: 'normal', ralphCancelRequestedAt: null,
    ralphCancelRequestedBy: null, ralphCancelRequestedByDisplayName: null,
    deadline: null, priority: null, createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'), delegation: null,
    ...over,
  };
}

function makeDeps(project: Project | null, tasks: Task[]) {
  const projects = {
    async getBySlug(slug: string) {
      return project && project.publicSlug === slug ? project : null;
    },
  } as unknown as ProjectRepository;
  const taskRepo = {
    async listByProject() {
      return tasks;
    },
  } as unknown as TaskRepository;
  return { projects, tasks: taskRepo };
}

test('GetPublicBoard: опубликованный проект → доска с колонками и полями шапки', async () => {
  const deps = makeDeps(makeProject(), [
    makeTask({ id: 'a', status: 'todo' }),
    makeTask({ id: 'b', status: 'in_progress' }),
    makeTask({ id: 'c', status: 'todo' }),
  ]);
  const board = await new GetPublicBoard(deps).execute('cookie-opinion-k3f9q2');
  assert.ok(board);
  assert.equal(board!.name, 'Persona');
  assert.equal(board!.slug, 'cookie-opinion-k3f9q2');
  const todo = board!.columns.find((c) => c.status === 'todo')!;
  assert.deepEqual(todo.tasks.map((t) => t.id), ['a', 'c']);
  const inProgress = board!.columns.find((c) => c.status === 'in_progress')!;
  assert.deepEqual(inProgress.tasks.map((t) => t.id), ['b']);
});

test('GetPublicBoard: не опубликован (is_public=0) → null', async () => {
  const deps = makeDeps(makeProject({ isPublic: false }), []);
  const board = await new GetPublicBoard(deps).execute('cookie-opinion-k3f9q2');
  assert.equal(board, null);
});

test('GetPublicBoard: неизвестный slug → null', async () => {
  const deps = makeDeps(makeProject(), []);
  const board = await new GetPublicBoard(deps).execute('nope-nope-000000');
  assert.equal(board, null);
});

test('GetPublicBoard: приватные поля задачи не утекают', async () => {
  const deps = makeDeps(makeProject(), [makeTask({ createdBy: 'secret-user' })]);
  const board = await new GetPublicBoard(deps).execute('cookie-opinion-k3f9q2');
  const task = board!.columns.flatMap((c) => c.tasks)[0]!;
  const keys = Object.keys(task).sort();
  assert.deepEqual(keys, [
    'cover', 'coverPosition', 'deadline', 'description', 'icon', 'id', 'priority', 'status',
  ]);
  assert.ok(!('createdBy' in task));
  assert.ok(!('ralphMode' in task));
  assert.ok(!('position' in task));
});

test('publicCoverUrl: gradient и внешний URL — как есть; загруженный файл — на публичный роут', () => {
  assert.equal(publicCoverUrl('slug1', 'gradient:sky'), 'gradient:sky');
  assert.equal(publicCoverUrl('slug1', 'https://cdn.example/x.jpg'), 'https://cdn.example/x.jpg');
  assert.equal(
    publicCoverUrl('slug1', '/api/projects/p1/cover/abc.jpg'),
    '/api/public/boards/slug1/cover',
  );
  assert.equal(publicCoverUrl('slug1', null), null);
});
