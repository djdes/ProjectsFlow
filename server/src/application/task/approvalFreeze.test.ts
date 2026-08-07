import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task, TaskStatus } from '../../domain/task/Task.js';
import type { WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
import { CreateTaskComment } from './CreateTaskComment.js';
import { DeleteTask } from './DeleteTask.js';
import { MoveTaskToProject } from './MoveTaskToProject.js';
import { TaskApprovalService } from './TaskApprovalService.js';

// Заморозки на время приёмки больше НЕТ: задача в очереди утверждения редактируется
// наравне с остальными (решение владельца продукта). Тесты сторожат именно это — раньше
// правка/удаление/перенос исполнителем отбивались ошибкой, и массовые действия по такой
// выборке падали целиком («Перенесено: 0 из 5»). Право закрыть задачу в done осталось
// за принимающим — это отдельное правило (TaskApprovalService), см. MoveTask.approval.test.

const PROJECT_ID = 'project-1';
const TARGET_PROJECT_ID = 'project-2';
const WORKSPACE_ID = 'ws-1';
const TASK_ID = 'task-1';

function makeTask(status: TaskStatus): Task {
  return {
    id: TASK_ID,
    projectId: PROJECT_ID,
    createdBy: 'creator',
    assignee: { userId: 'employee', displayName: 'Сотрудник', avatarUrl: null },
    description: 'Сверстать лендинг',
    icon: null,
    cover: null,
    coverPosition: 50,
    status,
    statusBeforeDone: null,
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

// Политика — настоящая (TaskApprovalService), фейковые только внешние зависимости: тогда
// тест проверяет реальное правило, а не заглушку.
function makeApproval(actorRole: WorkspaceRole | null): TaskApprovalService {
  return new TaskApprovalService({
    workspaces: {
      getById: async () => ({
        id: WORKSPACE_ID,
        name: 'Команда',
        icon: null,
        kind: 'team',
        requireTaskApproval: true,
        ownerUserId: 'owner',
        createdAt: new Date(0),
      }),
      getMembership: async (workspaceId: string, userId: string) =>
        actorRole === null ? null : { workspaceId, userId, role: actorRole },
      listMembers: async () => [{ workspaceId: WORKSPACE_ID, userId: 'boss', role: 'lead' }],
    } as never,
    users: { getById: async (id: string) => ({ id, email: `${id}@x`, displayName: id }) } as never,
    notifications: { create: async () => ({}) as never } as never,
    email: { send: async () => {} },
    idGen: () => 'n1',
    appUrl: 'https://pf.test/',
  });
}

function projectsFake(): never {
  return {
    getById: async (id: string) => ({
      id,
      workspaceId: WORKSPACE_ID,
      ownerId: 'owner',
      name: id,
      isInbox: false,
    }),
  } as never;
}

function membersFake(): never {
  return {
    findForProject: async (projectId: string, userId: string) => ({
      projectId,
      userId,
      role: 'editor',
    }),
    listSharedUsers: async () => [],
    // CreateTaskComment дёргает его для @-упоминаний (best-effort). Без заглушки тест
    // проходит, но сыпет в вывод пойманной ошибкой — шум маскирует реальные падения.
    listByProject: async () => [],
  } as never;
}

function makeDelete(input: { actorRole: WorkspaceRole | null; taskStatus: TaskStatus }) {
  let deleted: string | null = null;
  const task = makeTask(input.taskStatus);
  const del = new DeleteTask({
    projects: projectsFake(),
    members: membersFake(),
    tasks: {
      getById: async () => task,
      softDelete: async (id: string) => {
        deleted = id;
        return true;
      },
    } as never,
    comments: {} as never,
    approval: makeApproval(input.actorRole),
  });
  return { del, deleted: (): string | null => deleted };
}

function makeMoveToProject(input: { actorRole: WorkspaceRole | null; taskStatus: TaskStatus }) {
  let movedTo: string | null = null;
  const task = makeTask(input.taskStatus);
  const move = new MoveTaskToProject({
    projects: projectsFake(),
    members: membersFake(),
    tasks: {
      getById: async () => task,
      moveToProject: async (_id: string, targetProjectId: string) => {
        movedTo = targetProjectId;
        return { ...task, projectId: targetProjectId };
      },
    } as never,
    approval: makeApproval(input.actorRole),
  });
  return { move, movedTo: (): string | null => movedTo };
}

function makeComment(input: { actorRole: WorkspaceRole | null; taskStatus: TaskStatus }) {
  let created: string | null = null;
  const task = makeTask(input.taskStatus);
  const create = new CreateTaskComment({
    projects: projectsFake(),
    members: membersFake(),
    tasks: { getById: async () => task } as never,
    comments: {
      create: async (row: { body: string }) => {
        created = row.body;
        return { ...row, createdAt: new Date(0), updatedAt: new Date(0) };
      },
    } as never,
    idGen: () => 'c1',
    approval: makeApproval(input.actorRole),
  } as never);
  return { create, created: (): string | null => created };
}

// Тред открыт: исполнителю нужно отвечать на замечания, пока работа лежит в очереди.
test('исполнитель комментирует задачу на утверждении', async () => {
  const h = makeComment({ actorRole: 'editor', taskStatus: 'pending_approval' });

  await h.create.execute({
    projectId: PROJECT_ID,
    taskId: TASK_ID,
    ownerUserId: 'employee',
    body: 'готово, посмотрите',
  });

  assert.equal(h.created(), 'готово, посмотрите');
});

test('руководитель задачу на утверждении комментировать может', async () => {
  const h = makeComment({ actorRole: 'lead', taskStatus: 'pending_approval' });

  await h.create.execute({
    projectId: PROJECT_ID,
    taskId: TASK_ID,
    ownerUserId: 'boss',
    body: 'переделай отступы',
  });

  assert.equal(h.created(), 'переделай отступы');
});

test('вне очереди приёмки комментарий работает как раньше', async () => {
  const h = makeComment({ actorRole: 'editor', taskStatus: 'todo' });

  await h.create.execute({
    projectId: PROJECT_ID,
    taskId: TASK_ID,
    ownerUserId: 'employee',
    body: 'взял в работу',
  });

  assert.equal(h.created(), 'взял в работу');
});

test('исполнитель удаляет задачу на утверждении', async () => {
  const h = makeDelete({ actorRole: 'editor', taskStatus: 'pending_approval' });

  await h.del.execute(PROJECT_ID, 'employee', TASK_ID);

  assert.equal(h.deleted(), TASK_ID);
});

test('руководитель задачу на утверждении удалить может', async () => {
  const h = makeDelete({ actorRole: 'lead', taskStatus: 'pending_approval' });

  await h.del.execute(PROJECT_ID, 'boss', TASK_ID);

  assert.equal(h.deleted(), TASK_ID);
});

test('вне очереди приёмки удаление работает как раньше', async () => {
  const h = makeDelete({ actorRole: 'editor', taskStatus: 'todo' });

  await h.del.execute(PROJECT_ID, 'employee', TASK_ID);

  assert.equal(h.deleted(), TASK_ID);
});

// Ровно тот случай, из-за которого правило и сняли: массовый перенос из полки
// «На утверждении» падал целиком.
test('исполнитель переносит в другой проект задачу на утверждении', async () => {
  const h = makeMoveToProject({ actorRole: 'editor', taskStatus: 'pending_approval' });

  await h.move.execute(TASK_ID, TARGET_PROJECT_ID, 'employee');

  assert.equal(h.movedTo(), TARGET_PROJECT_ID);
});

test('руководитель задачу на утверждении перенести может', async () => {
  const h = makeMoveToProject({ actorRole: 'lead', taskStatus: 'pending_approval' });

  await h.move.execute(TASK_ID, TARGET_PROJECT_ID, 'boss');

  assert.equal(h.movedTo(), TARGET_PROJECT_ID);
});

test('вне очереди приёмки перенос в проект работает как раньше', async () => {
  const h = makeMoveToProject({ actorRole: 'editor', taskStatus: 'todo' });

  await h.move.execute(TASK_ID, TARGET_PROJECT_ID, 'employee');

  assert.equal(h.movedTo(), TARGET_PROJECT_ID);
});
