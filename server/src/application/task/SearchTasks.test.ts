import test from 'node:test';
import assert from 'node:assert/strict';

import { SearchTasks } from './SearchTasks.js';
import type {
  TaskSearchQuery,
  TaskSearchRepository,
  TaskSearchResult,
} from './TaskSearchRepository.js';

const result: TaskSearchResult = {
  taskId: 'task-docs',
  projectId: 'project-docs',
  projectName: 'DocsFlow',
  status: 'draft',
  excerpt: 'Update docs',
  createdAt: new Date('2026-07-18T10:00:00.000Z'),
};

test('ищет задачи по исходному запросу и варианту другой раскладки', async () => {
  const calls: string[] = [];
  const repository: TaskSearchRepository = {
    async search(query: TaskSearchQuery): Promise<TaskSearchResult[]> {
      calls.push(query.query);
      return query.query === 'docs' ? [result] : [];
    },
  };

  const found = await new SearchTasks({ search: repository }).execute('user-1', 'вщсы');

  assert.deepEqual(calls, ['вщсы', 'docs']);
  assert.deepEqual(found, [result]);
});

test('объединяет совпадения без дублей, оставляя прямые совпадения первыми', async () => {
  const repository: TaskSearchRepository = {
    async search(): Promise<TaskSearchResult[]> {
      return [result];
    },
  };

  const found = await new SearchTasks({ search: repository }).execute('user-1', 'docs');

  assert.equal(found.length, 1);
  assert.equal(found[0]?.taskId, result.taskId);
});

test('team-пространство передаёт workspaceId в поиск (изоляция)', async () => {
  const seen: (string | undefined)[] = [];
  const repository: TaskSearchRepository = {
    async search(q: TaskSearchQuery): Promise<TaskSearchResult[]> {
      seen.push(q.workspaceId);
      return [];
    },
  };
  await new SearchTasks({
    search: repository,
    resolveActiveWorkspace: async () => ({ id: 'ws-team', kind: 'team' }),
  }).execute('user-1', 'docs');

  // Поиск гоняется по вариантам раскладки — все они несут один и тот же workspaceId.
  assert.ok(seen.length > 0);
  assert.deepEqual([...new Set(seen)], ['ws-team']);
});

test('дефолт-хаб ищет без workspaceId (по всем моим проектам)', async () => {
  const seen: (string | undefined)[] = [];
  const repository: TaskSearchRepository = {
    async search(q: TaskSearchQuery): Promise<TaskSearchResult[]> {
      seen.push(q.workspaceId);
      return [];
    },
  };
  await new SearchTasks({
    search: repository,
    resolveActiveWorkspace: async () => ({ id: 'hub', kind: 'default' }),
  }).execute('user-1', 'docs');

  assert.ok(seen.length > 0);
  assert.deepEqual([...new Set(seen)], [undefined]);
});

test('нет активного пространства → пустой результат, БД не трогаем', async () => {
  let called = false;
  const repository: TaskSearchRepository = {
    async search(): Promise<TaskSearchResult[]> {
      called = true;
      return [result];
    },
  };
  const found = await new SearchTasks({
    search: repository,
    resolveActiveWorkspace: async () => null,
  }).execute('user-1', 'docs');

  assert.deepEqual(found, []);
  assert.equal(called, false);
});

test('admin ищет по всем проектам без workspace-скоупа даже при резолвере', async () => {
  const seen: { all: boolean; ws: string | undefined }[] = [];
  const repository: TaskSearchRepository = {
    async search(q: TaskSearchQuery): Promise<TaskSearchResult[]> {
      seen.push({ all: q.includeAllProjects, ws: q.workspaceId });
      return [];
    },
  };
  await new SearchTasks({
    search: repository,
    resolveActiveWorkspace: async () => ({ id: 'ws-team', kind: 'team' }),
  }).execute('admin-1', 'docs', { isAdmin: true });

  assert.ok(seen.length > 0);
  assert.ok(seen.every((s) => s.all === true && s.ws === undefined));
});
