import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task, TaskStatus } from '../../domain/task/Task.js';
import { NotTaskAssigneeError } from '../../domain/task/errors.js';
import { WithdrawTaskApproval } from './WithdrawTaskApproval.js';

// Отзыв работы из приёмки самим исполнителем: «случайно нажал выполнено». Забрать может
// только ответственный, и только туда, откуда задачу отправили.

const PROJECT_ID = 'p1';
const TASK_ID = 't1';

function makeTask(statusBeforeDone: TaskStatus | null): Task {
  return {
    id: TASK_ID,
    projectId: PROJECT_ID,
    createdBy: 'creator',
    assignee: { userId: 'employee', displayName: 'Сотрудник', avatarUrl: null },
    description: 'Сверстать лендинг',
    icon: null,
    cover: null,
    coverPosition: 50,
    status: 'pending_approval',
    statusBeforeDone,
    position: 1024,
    ralphMode: 'normal',
    deadline: null,
    startDate: null,
    parentTaskId: null,
    priority: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ralphCancelRequestedAt: null,
    ralphCancelRequestedBy: null,
  };
}

function makeWithdraw(statusBeforeDone: TaskStatus | null) {
  const moves: { targetStatus: TaskStatus; actor: string }[] = [];
  const task = makeTask(statusBeforeDone);
  const withdraw = new WithdrawTaskApproval({
    tasks: { getById: async () => task } as never,
    moveTask: {
      execute: async (cmd: {
        targetStatus: TaskStatus;
        ownerUserId: string;
      }) => {
        moves.push({
          targetStatus: cmd.targetStatus,
          actor: cmd.ownerUserId,
        });
        return { ...task, status: cmd.targetStatus };
      },
    } as never,
  });
  return { withdraw, moves };
}

test('исполнитель забирает задачу туда, откуда её отправил', async () => {
  const h = makeWithdraw('manual');

  const updated = await h.withdraw.execute({
    projectId: PROJECT_ID,
    taskId: TASK_ID,
    actorUserId: 'employee',
  });

  assert.deepEqual(h.moves, [{ targetStatus: 'manual', actor: 'employee' }]);
  assert.equal(updated.status, 'manual');
});

test('снимка нет — задача возвращается в работу, а не в начало пайплайна', async () => {
  const h = makeWithdraw(null);

  await h.withdraw.execute({ projectId: PROJECT_ID, taskId: TASK_ID, actorUserId: 'employee' });

  assert.equal(h.moves[0]?.targetStatus, 'in_progress');
});

test('негодный снимок (сама очередь) не берётся целью', async () => {
  const h = makeWithdraw('pending_approval');

  await h.withdraw.execute({ projectId: PROJECT_ID, taskId: TASK_ID, actorUserId: 'employee' });

  assert.equal(h.moves[0]?.targetStatus, 'in_progress');
});

test('не ответственный забрать задачу не может — ему доступен только возврат с комментарием', async () => {
  const h = makeWithdraw('manual');

  await assert.rejects(
    () => h.withdraw.execute({ projectId: PROJECT_ID, taskId: TASK_ID, actorUserId: 'boss' }),
    NotTaskAssigneeError,
  );
  assert.deepEqual(h.moves, []);
});
