import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task, TaskStatus } from '../../domain/task/Task.js';
import { ApprovalCommentRequiredError, NotTaskApproverError, TaskNotPendingApprovalError } from '../../domain/task/errors.js';
import type { CreateTaskCommentCommand } from './CreateTaskComment.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';
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

function makeReject(input: { canApprove: boolean; statusBeforeDone?: TaskStatus | null; status?: TaskStatus; movedConcurrently?: boolean; canSeeTask?: boolean }) {
  const calls = {
    comments: [] as string[],
    moves: [] as TaskStatus[],
    order: [] as string[],
    lastComment: undefined as CreateTaskCommentCommand | undefined,
  };
  const task = { ...makeTask(input.statusBeforeDone === undefined ? 'in_progress' : input.statusBeforeDone), status: input.status ?? 'pending_approval' };

  const reject = new RejectTaskApproval({
    projects: {
      getById: async () => ({ id: PROJECT_ID, workspaceId: 'ws', isInbox: false, name: 'Проект' }),
    } as never,
    tasks: { getById: async () => task } as never,
    members: {
      canSeeTask: async () => input.canSeeTask ?? true,
      findForProject: async () => ({ role: 'lead' }),
    } as never,
    approval: { canApprove: async () => input.canApprove },
    createComment: {
      execute: async (cmd: CreateTaskCommentCommand) => {
        calls.lastComment = cmd;
        calls.comments.push(cmd.body);
        calls.order.push('comment');
        // id нужен наружу: к этому комментарию клиент цепляет вложения.
        return { id: 'comment-1' } as never;
      },
    } as never,
    moveTask: {
      execute: async (cmd: { targetStatus: TaskStatus }) => {
        if (input.movedConcurrently) throw new TaskNotPendingApprovalError();
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
  assert.equal(updated.task.status, 'in_progress');
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
  assert.equal(updated.task.status, 'in_progress');
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

// Вложения («что доделать» скриншотом) грузятся в ТОТ ЖЕ комментарий, что создал возврат,
// поэтому его id обязан выходить наружу — без него клиенту некуда цеплять файлы.
test('возврат передаёт ссылку на ответ, цитату и адресатов и отдаёт созданный комментарий', async () => {
  const h = makeReject({ canApprove: true });

  const result = await h.reject.execute({
    projectId: PROJECT_ID,
    taskId: TASK_ID,
    actorUserId: 'boss',
    replyToCommentId: 'previous-comment',
    quotedText: 'Отправил на проверку',
    notifyMode: 'selected',
    notifyUserIds: ['employee'],
    comment: 'Смотри скриншот',
  });

  assert.equal(result.comment.id, 'comment-1');
  assert.equal(result.returned, true);
  assert.equal(h.calls.lastComment?.replyToCommentId, 'previous-comment');
  assert.equal(h.calls.lastComment?.quotedText, 'Отправил на проверку');
  assert.equal(h.calls.lastComment?.notifyMode, 'selected');
  assert.deepEqual(h.calls.lastComment?.notifyUserIds, ['employee']);
});

test('после ухода с утверждения повторный возврат отклоняется до записи комментария', async () => {
  const h = makeReject({ canApprove: true, status: 'done' });
  await assert.rejects(() => h.reject.execute({
    projectId: PROJECT_ID, taskId: TASK_ID, actorUserId: 'boss', comment: 'Нужны правки',
  }), TaskNotPendingApprovalError);
  assert.deepEqual(h.calls.order, []);
});

test('статус скрытой задачи не раскрывается через возврат', async () => {
  const h = makeReject({ canApprove: true, status: 'done', canSeeTask: false });
  await assert.rejects(() => h.reject.execute({
    projectId: PROJECT_ID, taskId: TASK_ID, actorUserId: 'boss', comment: 'Нужны правки',
  }), ProjectNotFoundError);
  assert.deepEqual(h.calls.order, []);
});

test('при одновременном решении о приёмке сообщает, что комментарий уже записан', async () => {
  const h = makeReject({ canApprove: true, movedConcurrently: true });
  const result = await h.reject.execute({
    projectId: PROJECT_ID, taskId: TASK_ID, actorUserId: 'boss', comment: 'Нужны правки',
  });
  assert.equal(result.returned, false);
  assert.equal(result.comment.id, 'comment-1');
  assert.deepEqual(h.calls.comments, ['Нужны правки']);
});
