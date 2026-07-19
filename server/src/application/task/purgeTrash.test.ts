import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../../domain/task/Task.js';
import { TaskNotFoundError } from '../../domain/task/errors.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';
import type { TrashedTaskRef } from './TaskRepository.js';
import { PurgeDeletedTask } from './PurgeDeletedTask.js';
import { PurgeTrashedTasks } from './PurgeTrashedTasks.js';

const ME = 'u-me';
const STRANGER = 'u-stranger';
const PROJECT = 'p1';
const OTHER_PROJECT = 'p2';
const NOW = new Date('2026-03-01T00:00:00Z');
const DAY_MS = 24 * 60 * 60_000;

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    projectId: PROJECT,
    createdBy: ME,
    assignee: { userId: ME, displayName: 'Я', avatarUrl: null },
    description: 'Задача',
    icon: null,
    cover: null,
    coverPosition: 50,
    status: 'todo',
    statusBeforeDone: null,
    position: 1024,
    ralphMode: 'normal',
    ralphCancelRequestedAt: null,
    ralphCancelRequestedBy: null,
    ralphCancelRequestedByDisplayName: null,
    deadline: null,
    startDate: null,
    parentTaskId: null,
    priority: null,
    deletedAt: null,
    deletedBy: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as Task;
}

// In-memory репозиторий: listTrashedBefore повторяет семантику SQL-фильтра
// (deleted_at IS NOT NULL AND deleted_at < cutoff), deleteWithChildren — физический DELETE.
function makeHarness(initial: readonly Task[]) {
  const store = new Map<string, Task>(initial.map((t) => [t.id, t]));

  const tasks = {
    getByIdIncludingDeleted: async (id: string): Promise<Task | null> => store.get(id) ?? null,
    listTrashedBefore: async (cutoff: Date, limit: number): Promise<readonly TrashedTaskRef[]> =>
      [...store.values()]
        .filter((t) => t.deletedAt !== null && t.deletedAt.getTime() < cutoff.getTime())
        .sort((a, b) => a.deletedAt!.getTime() - b.deletedAt!.getTime())
        .slice(0, limit)
        .map((t) => ({ id: t.id, projectId: t.projectId, deletedAt: t.deletedAt! })),
    deleteWithChildren: async (id: string): Promise<boolean> => store.delete(id),
    softDelete: async () => {
      throw new Error('softDelete не участвует в purge');
    },
  } as never;

  const deps = {
    tasks,
    projects: {
      getById: async (id: string) =>
        id === PROJECT || id === OTHER_PROJECT
          ? { id, isInbox: false, ownerId: ME, name: 'Проект' }
          : null,
    } as never,
    members: {
      findForProject: async (_p: string, userId: string) =>
        userId === ME ? { role: 'owner' } : null,
    } as never,
  };

  return {
    store,
    ids: () => [...store.keys()].sort(),
    purgeAll: new PurgeTrashedTasks({ tasks, now: () => NOW }),
    purgeOne: new PurgeDeletedTask(deps),
  };
}

test('автоочистка сносит залежавшееся в корзине и не трогает свежее и живое', async () => {
  const h = makeHarness([
    makeTask({ id: 't-old', deletedAt: new Date(NOW.getTime() - 31 * DAY_MS), deletedBy: ME }),
    makeTask({ id: 't-fresh', deletedAt: new Date(NOW.getTime() - 3 * DAY_MS), deletedBy: ME }),
    makeTask({ id: 't-alive' }),
    // Ровно на границе окна: 30 дней ещё не истекли — задача остаётся.
    makeTask({ id: 't-edge', deletedAt: new Date(NOW.getTime() - 30 * DAY_MS + 1), deletedBy: ME }),
  ]);

  const purged = await h.purgeAll.execute(30);

  assert.equal(purged, 1);
  assert.deepEqual(h.ids(), ['t-alive', 't-edge', 't-fresh']);
});

test('автоочистка не сносит корзину целиком при бессмысленном retention', async () => {
  const h = makeHarness([
    makeTask({ id: 't-today', deletedAt: NOW, deletedBy: ME }),
    makeTask({ id: 't-alive' }),
  ]);

  // 0/отрицательные дни зажимаются до 1 — иначе опечатка в конфиге вычистила бы всё сразу.
  assert.equal(await h.purgeAll.execute(0), 0);
  assert.equal(await h.purgeAll.execute(-5), 0);
  assert.deepEqual(h.ids(), ['t-alive', 't-today']);
});

test('«удалить навсегда» сносит задачу из корзины', async () => {
  const h = makeHarness([
    makeTask({ id: 't-trashed', deletedAt: new Date(NOW.getTime() - DAY_MS), deletedBy: ME }),
  ]);

  await h.purgeOne.execute(PROJECT, ME, 't-trashed');

  assert.deepEqual(h.ids(), []);
});

test('«удалить навсегда» не трогает живую задачу и чужой проект', async () => {
  const h = makeHarness([
    makeTask({ id: 't-alive' }),
    makeTask({
      id: 't-foreign',
      projectId: OTHER_PROJECT,
      deletedAt: new Date(NOW.getTime() - DAY_MS),
      deletedBy: ME,
    }),
  ]);

  await assert.rejects(
    () => h.purgeOne.execute(PROJECT, ME, 't-alive'),
    (e: unknown) => e instanceof TaskNotFoundError,
  );
  // Задача из другого проекта не сносится через корзину этого проекта.
  await assert.rejects(
    () => h.purgeOne.execute(PROJECT, ME, 't-foreign'),
    (e: unknown) => e instanceof TaskNotFoundError,
  );
  // Посторонний не видит проект вовсе.
  await assert.rejects(
    () => h.purgeOne.execute(OTHER_PROJECT, STRANGER, 't-foreign'),
    (e: unknown) => e instanceof ProjectNotFoundError,
  );

  assert.deepEqual(h.ids(), ['t-alive', 't-foreign']);
});
