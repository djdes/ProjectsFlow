import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task, TaskStatus } from '../../domain/task/Task.js';
import { ApprovalCommentRequiredError, NotTaskApproverError } from '../../domain/task/errors.js';
import { RejectTaskApproval } from './RejectTaskApproval.js';

// Возврат работы из приёмки (db/150): комментарий обязателен и пишется ДО переноса, а
// вернуть работу вправе только принимающий её.

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

function makeReject(input: { canApprove: boolean; statusBeforeDone?: TaskStatus | null }) {
  const calls = {
    comments: [] as string[],
    moves: [] as TaskStatus[],
    order: [] as string[],
  };
  const task = makeTask(input.statusBeforeDone ?? 'in_progress');

  const reject = new RejectTaskApproval({
    projects: {
      getById: async () => ({ id: PROJECT_ID, workspaceId: 'ws', isInbox: false, name: 'Проект' }),
    } as never,
    tasks: { getById: async () => task } as never,
    approval: { canApprove: async () => input.canApprove } as never,
    createComment: {
      execute: async (cmd: { body: string }) => {
        calls.comments.push(cmd.body);
        calls.order.push('comment');
        return {} as never;
      },
    } as never,
    moveTask: {
      execute: async (cmd: { targetStatus: TaskStatus }) => {
        calls.moves.push(cmd.targetStatus);
        calls.order.push('move');
        return { ...task, status: cmd.targetStatus };
      },
    } as never,
  });

  return { reject, calls };
}

test('возврат пишет комментарий и возвращает задачу в работу', async () => {
  const h = makeReject({ canApprove: true });

  const updated = await h.reject.execute({
    projectId: PROJECT_ID,
    taskId: TASK_ID,
    actorUserId: 'boss',
    comment: '  Не хватает адаптива на мобиле  ',
  });

  assert.deepEqual(h.calls.comments, ['Не хватает адаптива на мобиле']);
  assert.deepEqual(h.calls.moves, ['in_progress']);
  assert.equal(updated.status, 'in_progress');
});

// Регрессия с прода: у задачи снимок прежней колонки оказался равен 'pending_approval'
// (его затирала сама приёмка, см. гейт в MoveTask). Возврат отправлял задачу в очередь
// приёмки, то есть туда же, где она стояла: кнопка «Вернуть в работу» отрабатывала без
// ошибки и без результата.
test('снимок «pending_approval» не берётся целью — иначе возврат никуда не возвращает', async () => {
  const h = makeReject({ canApprove: true, statusBeforeDone: 'pending_approval' });

  const updated = await h.reject.execute({
    projectId: PROJECT_ID,
    taskId: TASK_ID,
    actorUserId: 'boss',
    comment: 'Переделай отступы',
  });

  assert.deepEqual(h.calls.moves, ['in_progress']);
  assert.equal(updated.status, 'in_progress');
});

test('снимок «done» тоже не берётся целью', async () => {
  const h = makeReject({ canApprove: true, statusBeforeDone: 'done' });

  await h.reject.execute({
    projectId: PROJECT_ID,
    taskId: TASK_ID,
    actorUserId: 'boss',
    comment: 'Ещё раз посмотри',
  });

  assert.deepEqual(h.calls.moves, ['in_progress']);
});

test('валидный снимок колонки уважается', async () => {
  const h = makeReject({ canApprove: true, statusBeforeDone: 'backlog' });

  await h.reject.execute({
    projectId: PROJECT_ID,
    taskId: TASK_ID,
    actorUserId: 'boss',
    comment: 'Вернул в черновики',
  });

  assert.deepEqual(h.calls.moves, ['backlog']);
});

test('комментарий пишется РАНЬШЕ переноса — иначе исполнитель узнает о возврате без причины', async () => {
  const h = makeReject({ canApprove: true });

  await h.reject.execute({
    projectId: PROJECT_ID,
    taskId: TASK_ID,
    actorUserId: 'boss',
    comment: 'Доделать валидацию',
  });

  assert.deepEqual(h.calls.order, ['comment', 'move']);
});

test('пустой комментарий отклоняется, задача не двигается', async () => {
  const h = makeReject({ canApprove: true });

  await assert.rejects(
    () =>
      h.reject.execute({
        projectId: PROJECT_ID,
        taskId: TASK_ID,
        actorUserId: 'boss',
        comment: '   ',
      }),
    ApprovalCommentRequiredError,
  );
  assert.deepEqual(h.calls.moves, []);
  assert.deepEqual(h.calls.comments, []);
});

test('не принимающий работу вернуть её не может', async () => {
  const h = makeReject({ canApprove: false });

  await assert.rejects(
    () =>
      h.reject.execute({
        projectId: PROJECT_ID,
        taskId: TASK_ID,
        actorUserId: 'employee',
        comment: 'верну себе',
      }),
    NotTaskApproverError,
  );
  // Ни комментария, ни переноса: отказ должен быть полным.
  assert.deepEqual(h.calls.comments, []);
  assert.deepEqual(h.calls.moves, []);
});

test('снимок прежней колонки уважается: задача возвращается туда, откуда её отправили', async () => {
  const h = makeReject({ canApprove: true, statusBeforeDone: 'manual' });

  await h.reject.execute({
    projectId: PROJECT_ID,
    taskId: TASK_ID,
    actorUserId: 'boss',
    comment: 'Ещё не готово',
  });

  assert.deepEqual(h.calls.moves, ['manual']);
});

test('снимка нет — возвращаем в работу, а не в начало пайплайна', async () => {
  const h = makeReject({ canApprove: true, statusBeforeDone: null });

  await h.reject.execute({
    projectId: PROJECT_ID,
    taskId: TASK_ID,
    actorUserId: 'boss',
    comment: 'Ещё не готово',
  });

  assert.deepEqual(h.calls.moves, ['in_progress']);
});
