import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../../domain/task/Task.js';
import { buildLeadDigest, renderLeadDigestTelegram } from './buildLeadDigest.js';

function task(over: Partial<Task> & { id: string; assigneeName: string }): Task {
  return {
    id: over.id,
    projectId: over.projectId ?? 'p1',
    createdBy: 'u-author',
    assignee: {
      userId: over.assignee?.userId ?? `user-${over.assigneeName}`,
      displayName: over.assigneeName,
      avatarUrl: null,
    },
    description: over.description ?? 'Задача\nподробности',
    icon: null,
    cover: null,
    coverPosition: 50,
    status: over.status ?? 'todo',
    statusBeforeDone: null,
    position: 1024,
    ralphMode: 'normal',
    ralphCancelRequestedAt: null,
    ralphCancelRequestedBy: null,
    ralphCancelRequestedByDisplayName: null,
    deadline: over.deadline ?? null,
    startDate: null,
    parentTaskId: null,
    priority: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
  } as Task;
}

const projectNames = new Map([
  ['p1', 'ScanFlow'],
  ['p2', 'DocsFlow'],
]);

const base = { workspaceName: 'Пространство', dateMsk: '2026-07-27', projectNameById: projectNames };

test('группирует по ответственным, самые загруженные сверху', () => {
  const model = buildLeadDigest({
    ...base,
    tasks: [
      task({ id: 't1', assigneeName: 'Олег' }),
      task({ id: 't2', assigneeName: 'Олег' }),
      task({ id: 't3', assigneeName: 'Денис' }),
    ],
  });

  assert.equal(model.activeCount, 3);
  assert.deepEqual(
    model.groups.map((g) => [g.displayName, g.tasks.length]),
    [
      ['Олег', 2],
      ['Денис', 1],
    ],
  );
});

test('завершённые задачи в сводку не попадают', () => {
  const model = buildLeadDigest({
    ...base,
    tasks: [task({ id: 't1', assigneeName: 'Олег', status: 'done' }), task({ id: 't2', assigneeName: 'Олег' })],
  });

  assert.equal(model.activeCount, 1);
});

test('просрочка — дедлайн строго раньше сегодняшней даты', () => {
  const model = buildLeadDigest({
    ...base,
    tasks: [
      task({ id: 't1', assigneeName: 'Олег', deadline: '2026-07-26' }),
      task({ id: 't2', assigneeName: 'Олег', deadline: '2026-07-27' }),
      task({ id: 't3', assigneeName: 'Олег', deadline: '2026-07-28' }),
      // Просроченная, но уже закрытая — не проблема, в секцию не идёт.
      task({ id: 't4', assigneeName: 'Денис', deadline: '2026-07-01', status: 'done' }),
    ],
  });

  assert.deepEqual(model.overdue.map((t) => t.taskId), ['t1']);
});

test('заголовок задачи — первая строка описания, без markdown-разметки', () => {
  const model = buildLeadDigest({
    ...base,
    tasks: [task({ id: 't1', assigneeName: 'Олег', description: '**Починить импорт**\n\nдетали' })],
  });

  assert.equal(model.groups[0]?.tasks[0]?.title, 'Починить импорт');
});

test('внутри человека — ближайший срок первым, без срока в конце', () => {
  const model = buildLeadDigest({
    ...base,
    tasks: [
      task({ id: 't1', assigneeName: 'Олег' }),
      task({ id: 't2', assigneeName: 'Олег', deadline: '2026-08-01' }),
      task({ id: 't3', assigneeName: 'Олег', deadline: '2026-07-29' }),
    ],
  });

  assert.deepEqual(model.groups[0]?.tasks.map((t) => t.taskId), ['t3', 't2', 't1']);
});

test('telegram-рендер: имена, счётчики и секция просрочек', () => {
  const model = buildLeadDigest({
    ...base,
    tasks: [
      task({ id: 't1', assigneeName: 'Олег', deadline: '2026-07-20' }),
      task({ id: 't2', assigneeName: 'Денис', projectId: 'p2' }),
    ],
  });

  const text = renderLeadDigestTelegram(model);

  assert.match(text, /Активных задач: <b>2<\/b>/u);
  assert.match(text, /👤 <b>Олег<\/b> — 1/u);
  assert.match(text, /DocsFlow/u);
  assert.match(text, /⏰ <b>Просрочено: 1<\/b>/u);
});

test('пустое пространство рендерится без падения', () => {
  const model = buildLeadDigest({ ...base, tasks: [] });

  assert.equal(model.activeCount, 0);
  assert.match(renderLeadDigestTelegram(model), /Активных задач нет/u);
});
