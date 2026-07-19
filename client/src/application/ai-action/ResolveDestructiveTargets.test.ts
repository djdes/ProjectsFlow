import assert from 'node:assert/strict';
import test from 'node:test';
import type { Task } from '@/domain/task/Task';
import type { AiAction } from '@/domain/ai-action/AiAction';
import type { TaskRepository } from '@/application/task/TaskRepository';
import { ResolveDestructiveTargets } from './ResolveDestructiveTargets';

function task(id: string, description: string | null): Task {
  // В тесте нужен только id/description — остальную часть сущности не воспроизводим.
  return { id, description } as Task;
}

function repository(tasksByProject: Record<string, Task[]>): { repo: TaskRepository; calls: string[] } {
  const calls: string[] = [];
  const repo = {
    list: async (projectId: string): Promise<Task[]> => {
      calls.push(projectId);
      return tasksByProject[projectId] ?? [];
    },
  } as unknown as TaskRepository;
  return { repo, calls };
}

const deleteAll: AiAction = { id: 'd1', type: 'delete_all_tasks', projectId: 'project-1' };

test('bulk deletion is expanded into named tasks before the decision', async () => {
  const { repo } = repository({ 'project-1': [task('a', 'написать документацию'), task('b', 'сверстать макет')] });
  const entities = await new ResolveDestructiveTargets(repo).execute([{ action: deleteAll, projectId: 'project-1' }]);
  assert.deepEqual(entities.map((entity) => entity.title), ['написать документацию', 'сверстать макет']);
  assert.deepEqual(entities.map((entity) => entity.entityId), ['a', 'b']);
  assert.equal(entities[0]?.kind, 'task');
});

test('task list is read once per project for the whole plan', async () => {
  const single: AiAction = { id: 'd2', type: 'delete_task', projectId: 'project-1', taskId: 'a' };
  const { repo, calls } = repository({ 'project-1': [task('a', 'написать документацию')] });
  await new ResolveDestructiveTargets(repo).execute([
    { action: deleteAll, projectId: 'project-1' },
    { action: single, projectId: 'project-1' },
  ]);
  assert.deepEqual(calls, ['project-1']);
});

test('safe actions never appear among affected entities', async () => {
  const create: AiAction = { id: 'c1', type: 'create_task', projectId: 'project-1', description: 'новая' };
  const { repo, calls } = repository({ 'project-1': [task('a', 'написать документацию')] });
  const entities = await new ResolveDestructiveTargets(repo).execute([{ action: create, projectId: 'project-1' }]);
  assert.deepEqual(entities, []);
  assert.deepEqual(calls, []);
});

test('missing and untitled tasks stay visible in the review list', async () => {
  const missing: AiAction = { id: 'd3', type: 'delete_task', projectId: 'project-1', taskId: 'gone' };
  const untitled: AiAction = { id: 'd4', type: 'delete_task', projectId: 'project-1', taskId: 'a' };
  const { repo } = repository({ 'project-1': [task('a', '   ')] });
  const entities = await new ResolveDestructiveTargets(repo).execute([
    { action: missing, projectId: 'project-1' },
    { action: untitled, projectId: 'project-1' },
  ]);
  assert.equal(entities.length, 2);
  assert.equal(entities[0]?.title, 'Без названия');
  assert.equal(entities[1]?.title, 'Без названия');
});

test('only the first line of a multiline description becomes the title', async () => {
  const { repo } = repository({ 'project-1': [task('a', 'собрать требования\nподробности ниже')] });
  const entities = await new ResolveDestructiveTargets(repo).execute([{ action: deleteAll, projectId: 'project-1' }]);
  assert.equal(entities[0]?.title, 'собрать требования');
});
