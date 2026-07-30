import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task, TaskStatus } from '../../domain/task/Task.js';
import type { WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
import { MoveTask } from './MoveTask.js';
import { TaskApprovalService } from './TaskApprovalService.js';

// Приёмка задач руководителем (db/150). Проверяем ровно правило, а не позиционную
// математику: исполнитель своим «выполнено» отправляет задачу НА УТВЕРЖДЕНИЕ, закрывает
// её только руководитель/владелец, и всё это включается флагом пространства.

const PROJECT_ID = 'project-1';
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

function makeMove(input: {
  requireTaskApproval: boolean;
  actorRole: WorkspaceRole | null;
  isInbox?: boolean;
  taskStatus?: TaskStatus;
}) {
  let saved: { status: TaskStatus } | null = null;
  const task = makeTask(input.taskStatus ?? 'todo');
  const notified: string[] = [];

  // Политика — настоящая: тогда тест проверяет реальное правило, а не заглушку. Внешние
  // зависимости (пространство, юзеры, уведомления) фейковые.
  const workspacesFake = {
    getById: async () => ({
      id: WORKSPACE_ID,
      name: 'Команда',
      icon: null,
      kind: 'team',
      requireTaskApproval: input.requireTaskApproval,
      ownerUserId: 'owner',
      createdAt: new Date(0),
    }),
    getMembership: async (workspaceId: string, userId: string) =>
      input.actorRole === null ? null : { workspaceId, userId, role: input.actorRole },
    listMembers: async () => [{ workspaceId: WORKSPACE_ID, userId: 'boss', role: 'lead' }],
  } as never;

  const approval = new TaskApprovalService({
    workspaces: workspacesFake,
    users: { getById: async (id: string) => ({ id, email: `${id}@x`, displayName: id }) } as never,
    notifications: {
      create: async (i: { userId: string }) => {
        notified.push(i.userId);
        return {} as never;
      },
    } as never,
    email: { send: async () => {} },
    idGen: () => 'n1',
    appUrl: 'https://pf.test/',
  });

  const move = new MoveTask({
    projects: {
      getById: async () => ({
        id: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        ownerId: 'owner',
        name: 'Проект',
        isInbox: input.isInbox ?? false,
      }),
    } as never,
    members: {
      findForProject: async (projectId: string, userId: string) => ({
        projectId,
        userId,
        role: 'editor',
      }),
    } as never,
    tasks: {
      getById: async () => task,
      getPositionBounds: async () => ({ min: 0, max: 2048 }),
      update: async (_id: string, patch: { status?: TaskStatus }) => {
        saved = { status: patch.status ?? task.status };
        return { ...task, status: patch.status ?? task.status };
      },
    } as never,
    approval,
  });

  return {
    move,
    savedStatus: (): TaskStatus | null => saved?.status ?? null,
    notified: (): string[] => notified,
  };
}

const done = { projectId: PROJECT_ID, taskId: TASK_ID, targetStatus: 'done' as const, beforeTaskId: null, afterTaskId: null };

test('приёмка включена: «выполнено» от исполнителя уходит на утверждение', async () => {
  const h = makeMove({ requireTaskApproval: true, actorRole: 'editor' });

  await h.move.execute({ ...done, ownerUserId: 'employee' });

  assert.equal(h.savedStatus(), 'pending_approval');
});

test('приёмка включена: руководитель закрывает задачу сам', async () => {
  const h = makeMove({ requireTaskApproval: true, actorRole: 'lead' });

  await h.move.execute({ ...done, ownerUserId: 'boss' });

  assert.equal(h.savedStatus(), 'done');
});

test('приёмка включена: владелец пространства закрывает задачу сам', async () => {
  const h = makeMove({ requireTaskApproval: true, actorRole: 'owner' });

  await h.move.execute({ ...done, ownerUserId: 'owner' });

  assert.equal(h.savedStatus(), 'done');
});

test('руководитель принимает работу: pending_approval → done', async () => {
  const h = makeMove({
    requireTaskApproval: true,
    actorRole: 'lead',
    taskStatus: 'pending_approval',
  });

  await h.move.execute({ ...done, ownerUserId: 'boss' });

  assert.equal(h.savedStatus(), 'done');
});

test('приёмка выключена: всё как раньше, задача закрывается сразу', async () => {
  const h = makeMove({ requireTaskApproval: false, actorRole: 'editor' });

  await h.move.execute({ ...done, ownerUserId: 'employee' });

  assert.equal(h.savedStatus(), 'done');
});

test('личные входящие приёмку не проходят — утверждать не у кого', async () => {
  const h = makeMove({ requireTaskApproval: true, actorRole: 'editor', isInbox: true });

  await h.move.execute({ ...done, ownerUserId: 'employee' });

  assert.equal(h.savedStatus(), 'done');
});

test('перенос в другую колонку приёмкой не затрагивается', async () => {
  const h = makeMove({ requireTaskApproval: true, actorRole: 'editor' });

  await h.move.execute({
    projectId: PROJECT_ID,
    taskId: TASK_ID,
    ownerUserId: 'employee',
    targetStatus: 'in_progress',
    beforeTaskId: null,
    afterTaskId: null,
  });

  assert.equal(h.savedStatus(), 'in_progress');
});

test('попадание в очередь приёмки уведомляет руководителя', async () => {
  const h = makeMove({ requireTaskApproval: true, actorRole: 'editor' });

  await h.move.execute({ ...done, ownerUserId: 'employee' });
  // Уведомление отправляется вне основного потока (void + catch), поэтому даём микротаскам
  // провернуться — иначе тест проверял бы состояние до отправки.
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(h.notified(), ['boss']);
});

test('руководитель, закрывший задачу сам, уведомление не получает', async () => {
  const h = makeMove({ requireTaskApproval: true, actorRole: 'lead' });

  await h.move.execute({ ...done, ownerUserId: 'boss' });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(h.notified(), []);
});
