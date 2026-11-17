import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TaskChange } from '../../domain/notifications/TaskChange.js';
import { InsufficientProjectRoleError } from '../../domain/project/errors.js';
import { AssigneeNotProjectMemberError } from '../../domain/task/errors.js';
import type { Task, TaskStatus } from '../../domain/task/Task.js';
import type { TaskRecurrence } from '../../domain/task/TaskRecurrence.js';
import type { CreateTaskCommand } from './CreateTask.js';
import type { TaskRecurrenceLedger } from './TaskRepository.js';
import { RECURRING_TASK_INITIAL_STATUS, SpawnNextRecurringTask } from './SpawnNextRecurringTask.js';

const NOW = new Date('2026-11-17T09:00:00Z'); // 12:00 МСК, вторник

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    projectId: 'p1',
    createdBy: 'u-author',
    assignee: { userId: 'u-assignee', displayName: 'Исполнитель', avatarUrl: null },
    description: 'Отчёт за день\n- [x] Собрать цифры\n- [ ] Отправить',
    icon: '📊',
    cover: null,
    coverPosition: 50,
    status: 'in_progress',
    statusBeforeDone: null,
    position: 1024,
    ralphMode: 'normal',
    ralphCancelRequestedAt: null,
    ralphCancelRequestedBy: null,
    ralphCancelRequestedByDisplayName: null,
    deadline: '2026-11-17',
    startDate: null,
    parentTaskId: null,
    priority: 2,
    taskType: 'feature',
    originWorkspaceId: null,
    recurrence: { kind: 'daily' },
    recurrenceNextTaskId: null,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-17T00:00:00Z'),
    ...overrides,
  };
}

// Леджер в памяти: та же семантика, что у UPDATE ... WHERE recurrence_next_task_id IS NULL.
function makeLedger(): TaskRecurrenceLedger & { slots: Map<string, string> } {
  const slots = new Map<string, string>();
  return {
    slots,
    claimNextOccurrence: async (taskId, nextTaskId) => {
      if (slots.has(taskId)) return false;
      slots.set(taskId, nextTaskId);
      return true;
    },
    replaceNextOccurrence: async (taskId, expected, next) => {
      if (slots.get(taskId) !== expected) return;
      if (next === null) slots.delete(taskId);
      else slots.set(taskId, next);
    },
  };
}

function makeHarness(opts: { createTask?: (cmd: CreateTaskCommand) => Promise<Task> } = {}) {
  const ledger = makeLedger();
  const commands: CreateTaskCommand[] = [];
  const realtime: string[] = [];
  let seq = 0;
  const spawner = new SpawnNextRecurringTask({
    ledger,
    createTask: {
      execute: async (cmd) => {
        commands.push(cmd);
        if (opts.createTask) return opts.createTask(cmd);
        return makeTask({
          id: `created-${commands.length}`,
          projectId: cmd.projectId,
          description: cmd.description,
          status: cmd.status,
          deadline: cmd.deadline ?? null,
          recurrence: cmd.recurrence ?? null,
        });
      },
    },
    idGen: () => `reservation-${++seq}`,
    now: () => NOW,
    onCreated: (task) => realtime.push(task.id),
    logger: { warn: () => {} },
  });
  return { spawner, ledger, commands, realtime };
}

function transition(
  from: TaskStatus,
  to: TaskStatus,
  overrides: Partial<Task> = {},
  actorUserId: string | null = 'u-actor',
): TaskChange {
  const previous = makeTask({ ...overrides, status: from });
  const task = makeTask({ ...overrides, status: to });
  return { task, previous, actorUserId, changedFields: ['status'] };
}

test('completing a recurring task creates the next occurrence through CreateTask', async () => {
  const h = makeHarness();
  const created = await h.spawner.onTaskChanged(transition('in_progress', 'done'));

  assert.equal(created?.id, 'created-1');
  assert.equal(h.commands.length, 1);
  const cmd = h.commands[0]!;
  assert.equal(cmd.projectId, 'p1');
  assert.equal(cmd.ownerUserId, 'u-author');
  assert.equal(cmd.assigneeUserId, 'u-assignee');
  assert.equal(cmd.status, RECURRING_TASK_INITIAL_STATUS);
  assert.equal(cmd.deadline, '2026-11-18');
  assert.equal(cmd.priority, 2);
  assert.equal(cmd.taskType, 'feature');
  assert.equal(cmd.icon, '📊');
  assert.deepEqual(cmd.recurrence, { kind: 'daily' });
  // Чеклист начинается заново.
  assert.equal(cmd.description, 'Отчёт за день\n- [ ] Собрать цифры\n- [ ] Отправить');
  // Слот выполненной задачи указывает на созданную копию, realtime отправлен.
  assert.equal(h.ledger.slots.get('t1'), 'created-1');
  assert.deepEqual(h.realtime, ['created-1']);
});

test('complete → reopen → complete does not spawn a second copy', async () => {
  const h = makeHarness();
  await h.spawner.onTaskChanged(transition('in_progress', 'done'));
  // Вернули в работу: задача уже помнит поставленный повтор.
  await h.spawner.onTaskChanged(transition('done', 'manual', { recurrenceNextTaskId: 'created-1' }));
  // Выполнили снова — даже если читатель не увидел пометку, атомарный слот не пустит.
  const second = await h.spawner.onTaskChanged(transition('manual', 'done'));

  assert.equal(second, null);
  assert.equal(h.commands.length, 1);
});

test('two concurrent completions create exactly one copy', async () => {
  const h = makeHarness();
  const results = await Promise.all([
    h.spawner.onTaskChanged(transition('in_progress', 'done')),
    h.spawner.onTaskChanged(transition('pending_approval', 'done')),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(h.commands.length, 1);
});

test('only a real transition into done triggers the next occurrence', async () => {
  const h = makeHarness();
  // Отправка на утверждение — ещё не выполнение.
  assert.equal(await h.spawner.onTaskChanged(transition('in_progress', 'pending_approval')), null);
  // Правка уже выполненной задачи.
  assert.equal(await h.spawner.onTaskChanged(transition('done', 'done')), null);
  // Создание сразу выполненной задачи.
  assert.equal(
    await h.spawner.onTaskChanged({ task: makeTask({ status: 'done' }), previous: null, actorUserId: 'u', changedFields: ['created'] }),
    null,
  );
  // Не повторяющаяся задача.
  assert.equal(await h.spawner.onTaskChanged(transition('todo', 'done', { recurrence: null })), null);
  assert.equal(h.commands.length, 0);
});

test('accepting from approval counts as completion', async () => {
  const h = makeHarness();
  const created = await h.spawner.onTaskChanged(transition('pending_approval', 'done'));
  assert.ok(created);
});

test('deadline follows the rule from the completed deadline, always in the future', async () => {
  const cases: Array<[TaskRecurrence, string | null, string]> = [
    // Просроченная ежедневная — на завтра, а не на «вчера + 1».
    [{ kind: 'daily' }, '2026-11-10', '2026-11-18'],
    // Без срока — от сегодняшнего дня.
    [{ kind: 'daily' }, null, '2026-11-18'],
    // По будням: пятница → понедельник.
    [{ kind: 'weekdays' }, '2026-11-20', '2026-11-23'],
    // Каждую неделю по пн и чт: вторник → четверг.
    [{ kind: 'weekly', days: [1, 4] }, '2026-11-17', '2026-11-19'],
    // Каждый месяц 31-го: из ноября (30 дней) — 31 декабря.
    [{ kind: 'monthly', day: 31 }, '2026-11-30', '2026-12-31'],
  ];
  for (const [recurrence, deadline, expected] of cases) {
    const h = makeHarness();
    await h.spawner.onTaskChanged(transition('todo', 'done', { recurrence, deadline }));
    assert.equal(h.commands[0]?.deadline, expected, `${JSON.stringify(recurrence)} from ${deadline}`);
  }
});

test('falls back to the next person when the author can no longer create tasks', async () => {
  const h = makeHarness({
    createTask: async (cmd) => {
      if (cmd.ownerUserId === 'u-author') throw new InsufficientProjectRoleError();
      return makeTask({ id: 'created-fallback', description: cmd.description });
    },
  });
  const created = await h.spawner.onTaskChanged(transition('todo', 'done'));
  assert.equal(created?.id, 'created-fallback');
  assert.deepEqual(h.commands.map((c) => c.ownerUserId), ['u-author', 'u-actor']);
});

test('an assignee who left the project is replaced by the person creating the copy', async () => {
  const h = makeHarness({
    createTask: async (cmd) => {
      if (cmd.assigneeUserId === 'u-assignee') throw new AssigneeNotProjectMemberError();
      return makeTask({ id: 'created-reassigned', assignee: { userId: cmd.assigneeUserId!, displayName: 'А', avatarUrl: null } });
    },
  });
  const created = await h.spawner.onTaskChanged(transition('todo', 'done'));
  assert.equal(created?.assignee.userId, 'u-author');
});

test('a failed creation releases the slot so a later completion can retry', async () => {
  let fail = true;
  const h = makeHarness({
    createTask: async (cmd) => {
      if (fail) throw new InsufficientProjectRoleError();
      return makeTask({ id: 'created-retry', description: cmd.description });
    },
  });
  assert.equal(await h.spawner.onTaskChanged(transition('todo', 'done')), null);
  assert.equal(h.ledger.slots.has('t1'), false);

  fail = false;
  const created = await h.spawner.onTaskChanged(transition('todo', 'done'));
  assert.equal(created?.id, 'created-retry');
  assert.equal(h.ledger.slots.get('t1'), 'created-retry');
});
