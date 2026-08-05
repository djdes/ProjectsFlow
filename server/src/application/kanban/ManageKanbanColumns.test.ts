import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KanbanColumnDuplicateError,
  KanbanColumnForbiddenError,
  KanbanColumnLimitError,
  KanbanColumnNotFoundError,
  ManageKanbanColumns,
} from './ManageKanbanColumns.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';
import type { KanbanBoardSettings } from '../../domain/kanban/KanbanSettings.js';

// Минимальные in-memory фейки (tsx + node:test, без новых deps).

function makeHarness(opts?: {
  settings?: KanbanBoardSettings;
  role?: 'owner' | 'editor' | 'viewer' | null;
  tasksInColumn?: number;
}) {
  let settings: KanbanBoardSettings = opts?.settings ?? {};
  const role = opts?.role === undefined ? 'owner' : opts.role;
  const bulkCalls: { projectIds: readonly string[]; from: string; to: string }[] = [];

  const useCase = new ManageKanbanColumns({
    projects: {
      async getKanbanSettings() {
        return settings;
      },
      async setKanbanSettings(_id: string, next: KanbanBoardSettings) {
        settings = next;
      },
    } as never,
    members: {
      async findForProject(projectId: string, userId: string) {
        return role ? ({ projectId, userId, role, joinedAt: new Date(0) } as never) : null;
      },
    } as never,
    tasks: {
      async bulkChangeStatus(projectIds: readonly string[], from: string, to: string) {
        bulkCalls.push({ projectIds, from, to });
        return opts?.tasksInColumn ?? 0;
      },
    } as never,
  });

  return { useCase, bulkCalls, current: () => settings };
}

const CMD = { projectId: 'p1', actorUserId: 'u1' } as const;

test('создание занимает первый свободный слот и сохраняет название', async () => {
  const h = makeHarness();
  const res = await h.useCase.create({ ...CMD, label: '  Ревью  ' });
  assert.equal(res.slot, 'custom_1');
  assert.equal(h.current().custom_1?.label, 'Ревью'); // затриммлено
});

test('следующая колонка занимает следующий слот, а освободившийся переиспользуется', async () => {
  const h = makeHarness();
  await h.useCase.create({ ...CMD, label: 'Ревью' });
  const second = await h.useCase.create({ ...CMD, label: 'Тестирование' });
  assert.equal(second.slot, 'custom_2');

  await h.useCase.delete({ ...CMD, slot: 'custom_1' });
  const third = await h.useCase.create({ ...CMD, label: 'Дизайн' });
  assert.equal(third.slot, 'custom_1'); // освободившийся слот берётся снова
});

test('дубль названия (регистр/пробелы не важны) отбивается', async () => {
  const h = makeHarness();
  await h.useCase.create({ ...CMD, label: 'Ревью' });
  await assert.rejects(
    () => h.useCase.create({ ...CMD, label: '  рЕвью ' }),
    KanbanColumnDuplicateError,
  );
});

test('шестая колонка отбивается лимитом', async () => {
  const h = makeHarness();
  for (const name of ['A', 'B', 'C', 'D', 'E']) {
    await h.useCase.create({ ...CMD, label: name });
  }
  await assert.rejects(() => h.useCase.create({ ...CMD, label: 'F' }), KanbanColumnLimitError);
});

test('удаление переселяет задачи в «Черновики» и гасит слот', async () => {
  const h = makeHarness({ tasksInColumn: 3 });
  await h.useCase.create({ ...CMD, label: 'Ревью' });
  const res = await h.useCase.delete({ ...CMD, slot: 'custom_1' });

  assert.equal(res.movedTasks, 3);
  assert.equal(h.current().custom_1, undefined); // слот свободен
  assert.deepEqual(h.bulkCalls, [{ projectIds: ['p1'], from: 'custom_1', to: 'backlog' }]);
});

test('удаление незанятого слота и не-слота — 404, без переноса задач', async () => {
  const h = makeHarness();
  await assert.rejects(
    () => h.useCase.delete({ ...CMD, slot: 'custom_3' }),
    KanbanColumnNotFoundError,
  );
  await assert.rejects(() => h.useCase.delete({ ...CMD, slot: 'done' }), KanbanColumnNotFoundError);
  assert.equal(h.bulkCalls.length, 0);
});

test('viewer колонки не меняет, не-участник получает 404 проекта', async () => {
  const viewer = makeHarness({ role: 'viewer' });
  await assert.rejects(
    () => viewer.useCase.create({ ...CMD, label: 'Ревью' }),
    KanbanColumnForbiddenError,
  );

  const stranger = makeHarness({ role: null });
  await assert.rejects(
    () => stranger.useCase.create({ ...CMD, label: 'Ревью' }),
    ProjectNotFoundError,
  );
});

test('создание не наследует цвет/скрытость от прошлой колонки в том же слоте', async () => {
  const h = makeHarness({
    settings: { custom_1: { label: 'Старая', color: 'red', hidden: true } },
  });
  await h.useCase.delete({ ...CMD, slot: 'custom_1' });
  await h.useCase.create({ ...CMD, label: 'Новая' });

  assert.deepEqual(h.current().custom_1, { label: 'Новая' });
});
