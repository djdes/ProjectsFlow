import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  requireTaskModifyAccess,
  requireTaskReadAccess,
  requireTaskDeleteAccess,
  type TaskAccessDeps,
} from './taskAuthorization.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';

/**
 * Личные задачи приватны: чужую личную задачу кроме владельца и ответственного видит и меняет
 * только коллега, который её поставил. Раньше любой участник общего пространства видел,
 * двигал и удалял все личные задачи коллег. Здесь закреплены и новое правило, и его ПРЕДЕЛ:
 * посторонний (нет общего пространства) не получает ничего, даже если когда-то ставил задачу.
 */

const INBOX = {
  id: 'bob-inbox',
  name: 'Входящие',
  isInbox: true,
  ownerId: 'bob',
} as const;

function makeDeps(options: {
  colleaguesOf?: Record<string, string[]>;
  assigneeUserId?: string;
  createdBy?: string;
  project?: Record<string, unknown>;
}): TaskAccessDeps {
  const colleaguesOf = options.colleaguesOf ?? {};
  const task = (id: string) =>
    ({
      id,
      projectId: INBOX.id,
      createdBy: options.createdBy ?? 'bob',
      assignee: { userId: options.assigneeUserId ?? 'bob' },
    }) as never;
  return {
    projects: {
      async getById(id: string) {
        return id === INBOX.id ? ({ ...INBOX, ...options.project } as never) : null;
      },
    } as never,
    members: {
      // Круг коллег формирует сервер: участники общих пространств, без самого caller'а.
      async listSharedUsers(userId: string) {
        return (colleaguesOf[userId] ?? []).map((id) => ({ id, displayName: id }));
      },
      async findForProject() {
        return null; // в чужом inbox'е membership'а нет ни у кого, кроме владельца
      },
    } as never,
    tasks: {
      async getById(id: string) {
        return task(id);
      },
      async getByIdIncludingDeleted(id: string) {
        return task(id);
      },
    } as never,
  };
}

test('коллега не видит, не двигает и не удаляет собственные личные задачи владельца', async () => {
  const deps = makeDeps({ colleaguesOf: { me: ['bob'] } });
  await assert.rejects(() => requireTaskReadAccess(deps, INBOX.id, 't1', 'me'), ProjectNotFoundError);
  await assert.rejects(
    () => requireTaskModifyAccess(deps, INBOX.id, 't1', 'me', 'move_task'),
    ProjectNotFoundError,
  );
  await assert.rejects(
    () => requireTaskDeleteAccess(deps, INBOX.id, 't1', 'me', 'delete_task'),
    ProjectNotFoundError,
  );
});

test('коллега, поставивший задачу, открывает, двигает и удаляет её в чужих «Входящих»', async () => {
  const deps = makeDeps({ colleaguesOf: { me: ['bob'] }, createdBy: 'me' });
  assert.equal((await requireTaskReadAccess(deps, INBOX.id, 't1', 'me')).project.id, INBOX.id);
  const access = await requireTaskModifyAccess(deps, INBOX.id, 't1', 'me', 'move_task');
  assert.equal(access.isAssignee, false);
  assert.ok(await requireTaskDeleteAccess(deps, INBOX.id, 't1', 'me', 'delete_task'));
  assert.ok(await requireTaskDeleteAccess(deps, INBOX.id, 't1', 'me', 'delete_task', { includeDeleted: true }));
});

// ГЛАВНОЕ: предел. Без общего пространства доступа нет ни к чему, даже к своей постановке.
test('посторонний без общего пространства не получает ни просмотра, ни правки, ни удаления', async () => {
  const deps = makeDeps({ colleaguesOf: { stranger: ['someone-else'] }, createdBy: 'stranger' });
  await assert.rejects(
    () => requireTaskModifyAccess(deps, INBOX.id, 't1', 'stranger', 'move_task'),
    ProjectNotFoundError,
  );
  await assert.rejects(
    () => requireTaskReadAccess(deps, INBOX.id, 't1', 'stranger'),
    ProjectNotFoundError,
  );
  await assert.rejects(
    () => requireTaskDeleteAccess(deps, INBOX.id, 't1', 'stranger', 'delete_task'),
    ProjectNotFoundError,
  );
});

test('владелец inbox сохраняет полный доступ', async () => {
  const deps = makeDeps({ colleaguesOf: {} });
  assert.equal((await requireTaskModifyAccess(deps, INBOX.id, 't1', 'bob', 'move_task')).isAssignee, true);
  assert.ok(await requireTaskDeleteAccess(deps, INBOX.id, 't1', 'bob', 'delete_task'));
});

// Ответственный правит поручённую ему задачу, а вот убирать её из чужих «Входящих» — нет.
test('ответственный правит задачу, но не удаляет её', async () => {
  const deps = makeDeps({ colleaguesOf: { outsider: [] }, assigneeUserId: 'outsider' });
  const access = await requireTaskModifyAccess(deps, INBOX.id, 't1', 'outsider', 'move_task');
  assert.equal(access.isAssignee, true);
  await assert.rejects(
    () => requireTaskDeleteAccess(deps, INBOX.id, 't1', 'outsider', 'delete_task'),
    ProjectNotFoundError,
  );
});
