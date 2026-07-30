import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task, TaskStatus } from '../../domain/task/Task.js';
import type { WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
import { DeleteTask } from './DeleteTask.js';
import { MoveTaskToProject } from './MoveTaskToProject.js';
import { TaskApprovalService } from './TaskApprovalService.js';

// Заморозка на время приёмки (db/150) на путях, которые ходят мимо requireTaskModifyAccess
// со своей авторизацией: удаление и перенос в другой проект. Оба уводили задачу из очереди
// руководителя руками исполнителя — правило должно быть одно для всех мутаций.

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

test('исполнитель не может удалить задачу, которая ждёт утверждения', async () => {
  const h = makeDelete({ actorRole: 'editor', taskStatus: 'pending_approval' });

  await assert.rejects(() => h.del.execute(PROJECT_ID, 'employee', TASK_ID), /утверждени/u);
  assert.equal(h.deleted(), null);
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

test('исполнитель не может перенести в другой проект задачу на утверждении', async () => {
  const h = makeMoveToProject({ actorRole: 'editor', taskStatus: 'pending_approval' });

  await assert.rejects(
    () => h.move.execute(TASK_ID, TARGET_PROJECT_ID, 'employee'),
    /утверждени/u,
  );
  assert.equal(h.movedTo(), null);
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
