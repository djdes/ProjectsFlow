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
