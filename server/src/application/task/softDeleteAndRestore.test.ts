import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../../domain/task/Task.js';
import { TaskNotFoundError } from '../../domain/task/errors.js';
import { DeleteTask } from './DeleteTask.js';
import { ListTrashedTasks } from './ListTrashedTasks.js';
import { RestoreDeletedTask } from './RestoreDeletedTask.js';

const ME = 'u-me';
const PROJECT = 'p1';
const TASK_ID = 't-stable-id';

function makeTask(): Task {
  return {
    id: TASK_ID,
    projectId: PROJECT,
    createdBy: ME,
    assignee: { userId: ME, displayName: 'Я', avatarUrl: null },
    description: 'Задача со ссылками, комментариями и историей',
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
  };
}

// In-memory TaskRepository с семантикой db/134: одна и та же строка помечается/размечается,
// новая задача НИКОГДА не создаётся. Так тест ловит регресс «Undo пересоздаёт задачу
// с новым id» — именно из-за него рвались ссылки, комментарии и история версий.
function makeHarness() {
  let stored: Task = makeTask();

  const tasks = {
    getById: async (id: string): Promise<Task | null> =>
      id === stored.id && !stored.deletedAt ? stored : null,
    getByIdIncludingDeleted: async (id: string): Promise<Task | null> =>
      id === stored.id ? stored : null,
    listByProject: async (projectId: string): Promise<Task[]> =>
      stored.projectId === projectId && !stored.deletedAt ? [stored] : [],
    listTrashedByProject: async (projectId: string): Promise<Task[]> =>
      stored.projectId === projectId && stored.deletedAt ? [stored] : [],
    softDelete: async (id: string, byUserId: string | null): Promise<boolean> => {
      if (id !== stored.id || stored.deletedAt) return false;
      stored = { ...stored, deletedAt: new Date('2026-02-01T00:00:00Z'), deletedBy: byUserId };
      return true;
    },
    restore: async (id: string): Promise<Task | null> => {
      if (id !== stored.id || !stored.deletedAt) return null;
      stored = { ...stored, deletedAt: null, deletedBy: null };
      return stored;
    },
    deleteWithChildren: async (): Promise<boolean> => {
      throw new Error('физический DELETE не должен вызываться при мягком удалении');
    },
  } as never;

  const deps = {
    tasks,
    projects: {
      getById: async (id: string) => ({ id, isInbox: false, ownerId: ME, name: 'Проект' }),
    } as never,
    members: {
      findForProject: async (_p: string, userId: string) =>
        userId === ME ? { role: 'owner' } : null,
    } as never,
    comments: {} as never,
  };

  return {
    deleteTask: new DeleteTask(deps),
    restoreTask: new RestoreDeletedTask(deps),
    listTrashed: new ListTrashedTasks(deps),
    listTasks: () => (deps.tasks as unknown as { listByProject: (p: string) => Promise<Task[]> })
      .listByProject(PROJECT),
    current: () => stored,
  };
}

test('удаление прячет задачу из выборок и кладёт её в корзину', async () => {
  const h = makeHarness();
  assert.equal((await h.listTasks()).length, 1);

  await h.deleteTask.execute(PROJECT, ME, TASK_ID);

  assert.deepEqual(await h.listTasks(), [], 'удалённая задача не должна возвращаться в списках');
  const trashed = await h.listTrashed.execute(PROJECT, ME);
  assert.equal(trashed.length, 1);
  assert.equal(trashed[0]!.id, TASK_ID);
  assert.equal(h.current().deletedBy, ME);
});

test('восстановление возвращает задачу С ТЕМ ЖЕ id (не пересоздаёт)', async () => {
  const h = makeHarness();
  const before = h.current();
  await h.deleteTask.execute(PROJECT, ME, TASK_ID);

  const restored = await h.restoreTask.execute(PROJECT, ME, TASK_ID);

  assert.equal(restored.id, TASK_ID, 'новый id порвал бы ссылки, комментарии и историю версий');
  assert.equal(restored.deletedAt, null);
  assert.equal(restored.createdAt.getTime(), before.createdAt.getTime());
  assert.equal(restored.description, before.description);
  assert.equal((await h.listTasks()).length, 1, 'задача должна вернуться в обычные выборки');
  assert.deepEqual(await h.listTrashed.execute(PROJECT, ME), []);
});

test('повторное удаление той же задачи — 404, а не второе удаление', async () => {
  const h = makeHarness();
  await h.deleteTask.execute(PROJECT, ME, TASK_ID);
  await assert.rejects(
    () => h.deleteTask.execute(PROJECT, ME, TASK_ID),
    (e: unknown) => e instanceof TaskNotFoundError,
  );
});

test('повторное восстановление идемпотентно (двойной клик по «Отменить»)', async () => {
  const h = makeHarness();
  await h.deleteTask.execute(PROJECT, ME, TASK_ID);
  await h.restoreTask.execute(PROJECT, ME, TASK_ID);

  const again = await h.restoreTask.execute(PROJECT, ME, TASK_ID);
  assert.equal(again.id, TASK_ID);
});
