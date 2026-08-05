import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BulkManageWorkspaceKanbanColumns } from './BulkManageWorkspaceKanbanColumns.js';
import { NotWorkspaceOwnerError, WorkspaceNotFoundError } from '../../domain/workspace/errors.js';
import type { KanbanBoardSettings } from '../../domain/kanban/KanbanSettings.js';

// Минимальные in-memory фейки (tsx + node:test, без новых deps).

function makeHarness(opts?: {
  projects?: Array<{ id: string; name: string; settings?: KanbanBoardSettings }>;
  role?: 'owner' | 'lead' | 'editor' | 'viewer' | null;
  tasksPerColumn?: number;
}) {
  const role = opts?.role === undefined ? 'owner' : opts.role;
  const settingsById = new Map<string, KanbanBoardSettings>();
  const list = opts?.projects ?? [
    { id: 'p1', name: 'Альфа' },
    { id: 'p2', name: 'Бета' },
  ];
  for (const p of list) settingsById.set(p.id, p.settings ?? {});
  const bulkCalls: { projectIds: readonly string[]; from: string; to: string }[] = [];

  const useCase = new BulkManageWorkspaceKanbanColumns({
    workspaces: {
      async getMembership(workspaceId: string, userId: string) {
        return role ? ({ workspaceId, userId, role, joinedAt: new Date(0) } as never) : null;
      },
    } as never,
    projects: {
      async listByWorkspace() {
        return list.map((p) => ({ id: p.id, name: p.name, icon: null }));
      },
      async getKanbanSettings(projectId: string) {
        return settingsById.get(projectId) ?? {};
      },
      async setKanbanSettings(projectId: string, next: KanbanBoardSettings) {
        settingsById.set(projectId, next);
      },
    } as never,
    tasks: {
      async bulkChangeStatus(projectIds: readonly string[], from: string, to: string) {
        bulkCalls.push({ projectIds, from, to });
        return opts?.tasksPerColumn ?? 0;
      },
    } as never,
  });

  return { useCase, bulkCalls, settingsOf: (id: string) => settingsById.get(id) ?? {} };
}

const WS = 'ws1';
const ACTOR = 'u1';

test('создание во всех проектах занимает свободный слот в каждом', async () => {
  const h = makeHarness();
  const res = await h.useCase.createEverywhere(WS, ACTOR, ' Ревью ');

  assert.equal(res.affected, 2);
  assert.equal(res.skipped.length, 0);
  assert.equal(h.settingsOf('p1').custom_1?.label, 'Ревью');
  assert.equal(h.settingsOf('p2').custom_1?.label, 'Ревью');
});

test('проект с такой колонкой и проект без слотов попадают в «пропущено»', async () => {
  const full: KanbanBoardSettings = {
    custom_1: { label: 'A' },
    custom_2: { label: 'B' },
    custom_3: { label: 'C' },
    custom_4: { label: 'D' },
    custom_5: { label: 'E' },
  };
  const h = makeHarness({
    projects: [
      { id: 'p1', name: 'Альфа' },
      { id: 'p2', name: 'Бета', settings: { custom_4: { label: 'ревью' } } },
      { id: 'p3', name: 'Гамма', settings: full },
    ],
  });
  const res = await h.useCase.createEverywhere(WS, ACTOR, 'Ревью');

  assert.equal(res.affected, 1); // только Альфа
  assert.deepEqual(
    res.skipped.map((s) => [s.name, s.reason]),
    [
      ['Бета', 'Колонка уже есть'],
      ['Гамма', 'Нет свободных слотов'],
    ],
  );
});

test('удаление по названию находит колонку в разных слотах и переселяет задачи', async () => {
  const h = makeHarness({
    projects: [
      { id: 'p1', name: 'Альфа', settings: { custom_1: { label: 'Ревью' } } },
      { id: 'p2', name: 'Бета', settings: { custom_3: { label: ' рЕвью ' } } },
      { id: 'p3', name: 'Гамма', settings: { custom_1: { label: 'Другое' } } },
    ],
    tasksPerColumn: 2,
  });
  const res = await h.useCase.deleteEverywhere(WS, ACTOR, 'Ревью');

  assert.equal(res.affected, 2); // Гамма не тронута
  assert.equal(res.movedTasks, 4); // по 2 задачи из двух проектов
  assert.deepEqual(h.bulkCalls, [
    { projectIds: ['p1'], from: 'custom_1', to: 'backlog' },
    { projectIds: ['p2'], from: 'custom_3', to: 'backlog' },
  ]);
  assert.equal(h.settingsOf('p1').custom_1, undefined);
  assert.equal(h.settingsOf('p2').custom_3, undefined);
  assert.equal(h.settingsOf('p3').custom_1?.label, 'Другое'); // чужая колонка цела
});

test('список колонок пространства схлопывает написания и считает проекты', async () => {
  const h = makeHarness({
    projects: [
      { id: 'p1', name: 'Альфа', settings: { custom_1: { label: 'Ревью' } } },
      { id: 'p2', name: 'Бета', settings: { custom_2: { label: 'ревью ' } } },
      { id: 'p3', name: 'Гамма', settings: { custom_1: { label: 'Тесты' } } },
    ],
  });
  const columns = await h.useCase.list(WS, ACTOR);

  assert.deepEqual(columns, [
    { label: 'Ревью', projectCount: 2 },
    { label: 'Тесты', projectCount: 1 },
  ]);
});

test('lead может, editor/viewer — нет, чужой видит 404 пространства', async () => {
  const lead = makeHarness({ role: 'lead' });
  assert.equal((await lead.useCase.createEverywhere(WS, ACTOR, 'Ревью')).affected, 2);

  const editor = makeHarness({ role: 'editor' });
  await assert.rejects(
    () => editor.useCase.createEverywhere(WS, ACTOR, 'Ревью'),
    NotWorkspaceOwnerError,
  );

  const stranger = makeHarness({ role: null });
  await assert.rejects(
    () => stranger.useCase.createEverywhere(WS, ACTOR, 'Ревью'),
    WorkspaceNotFoundError,
  );
});
