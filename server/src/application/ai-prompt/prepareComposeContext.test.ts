import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareComposeContext } from './prepareComposeContext.js';

// Минимальные in-memory фейки (tsx + node:test, без новых deps). Проверяем блок
// «Открытые задачи» — кандидатов на дополнение вместо создания дубля (B3).

function makeDeps(tasks?: any[]) {
  return {
    listProjects: {
      async execute() {
        return [{ id: 'p1', name: 'Альфа', role: 'owner', isInbox: false }] as any;
      },
    },
    listKbDocuments: { async execute() { return []; } },
    getKbDocument: { async execute() { return null; } },
    members: {
      async listByProject() {
        return [{ userId: 'u1', user: { displayName: 'Ярослав' } }] as any;
      },
    },
    ...(tasks ? { tasks: { async listByProjects() { return tasks as any; } } } : {}),
  } as any;
}

function task(over: Record<string, unknown> = {}) {
  return {
    id: 't1',
    projectId: 'p1',
    status: 'todo',
    description: '**Починить сборку**\n\nПадает на CI.',
    ...over,
  };
}

test('открытые задачи попадают в блок как [taskId=…] с выжимкой первой строки', async () => {
  const ctx = await prepareComposeContext('u1', makeDeps([task()]));
  assert.ok(ctx);
  assert.match(ctx!.block, /Открытые задачи \(кандидаты на дополнение\)/);
  assert.match(ctx!.block, /\[taskId=t1\] Починить сборку/); // markdown-шум срезан
});

test('закрытые задачи в кандидаты не попадают', async () => {
  const ctx = await prepareComposeContext(
    'u1',
    makeDeps([
      task({ id: 'done-1', status: 'done', description: 'Уже сделано' }),
      task({ id: 'appr-1', status: 'pending_approval', description: 'На приёмке' }),
    ]),
  );
  assert.ok(ctx);
  assert.doesNotMatch(ctx!.block, /taskId=/);
  assert.doesNotMatch(ctx!.block, /Открытые задачи/);
});

test('без tasks-репозитория блок собирается как раньше (деградация, не падение)', async () => {
  const ctx = await prepareComposeContext('u1', makeDeps());
  assert.ok(ctx);
  assert.match(ctx!.block, /\[projectId=p1\] Альфа/);
  assert.doesNotMatch(ctx!.block, /Открытые задачи/);
});

test('ошибка чтения задач не валит сборку контекста', async () => {
  const deps = makeDeps();
  deps.tasks = {
    async listByProjects() {
      throw new Error('БД недоступна');
    },
  };
  const ctx = await prepareComposeContext('u1', deps);
  assert.ok(ctx);
  assert.match(ctx!.block, /\[projectId=p1\] Альфа/);
  assert.doesNotMatch(ctx!.block, /Открытые задачи/);
});
