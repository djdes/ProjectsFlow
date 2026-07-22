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
 * Личные задачи коллег: право на действие должно совпадать с правом на просмотр.
 *
 * Раньше карточка чужой личной задачи была видна во «Входящих», но статус не менялся и
 * удалить её было нельзя — действия молча упирались в 404. Здесь закреплена новая граница
 * и, что важнее, её ПРЕДЕЛ: посторонний (нет общего пространства) не должен получить ничего.
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
  project?: Record<string, unknown>;
}): TaskAccessDeps {
  const colleaguesOf = options.colleaguesOf ?? {};
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
        return {
          id,
          projectId: INBOX.id,
          assignee: { userId: options.assigneeUserId ?? 'bob' },
        } as never;
      },
    } as never,
  };
}

test('коллега по общему пространству меняет статус личной задачи владельца', async () => {
  const deps = makeDeps({ colleaguesOf: { me: ['bob'] } });
  const access = await requireTaskModifyAccess(deps, INBOX.id, 't1', 'me', 'move_task');
  assert.equal(access.project.id, INBOX.id);
  assert.equal(access.isAssignee, false);
});

test('коллега удаляет личную задачу владельца', async () => {
  const deps = makeDeps({ colleaguesOf: { me: ['bob'] } });
  const access = await requireTaskDeleteAccess(deps, INBOX.id, 'me', 'delete_task');
  assert.equal(access.project.id, INBOX.id);
});

// Раз статус меняется — карточку надо уметь открыть, иначе полуфункциональное состояние.
test('коллега открывает карточку личной задачи владельца', async () => {
  const deps = makeDeps({ colleaguesOf: { me: ['bob'] } });
  const access = await requireTaskReadAccess(deps, INBOX.id, 't1', 'me');
  assert.equal(access.project.id, INBOX.id);
});

// ГЛАВНОЕ: предел расширения. Без общего пространства доступа нет ни к чему.
test('посторонний без общего пространства не получает ни просмотра, ни правки, ни удаления', async () => {
  const deps = makeDeps({ colleaguesOf: { stranger: ['someone-else'] } });
  await assert.rejects(
    () => requireTaskModifyAccess(deps, INBOX.id, 't1', 'stranger', 'move_task'),
    ProjectNotFoundError,
  );
  await assert.rejects(
    () => requireTaskReadAccess(deps, INBOX.id, 't1', 'stranger'),
    ProjectNotFoundError,
  );
  await assert.rejects(
    () => requireTaskDeleteAccess(deps, INBOX.id, 'stranger', 'delete_task'),
    ProjectNotFoundError,
  );
});

test('владелец inbox сохраняет полный доступ', async () => {
  const deps = makeDeps({ colleaguesOf: {} });
  assert.equal((await requireTaskModifyAccess(deps, INBOX.id, 't1', 'bob', 'move_task')).isAssignee, true);
  assert.ok(await requireTaskDeleteAccess(deps, INBOX.id, 'bob', 'delete_task'));
});

// Ответственный, которому задачу делегировали извне, править её может (так было и раньше),
// а вот убирать из чужих «Входящих» — нет: он не коллега владельца.
test('внешний ответственный правит задачу, но не удаляет её', async () => {
  const deps = makeDeps({ colleaguesOf: { outsider: [] }, assigneeUserId: 'outsider' });
  const access = await requireTaskModifyAccess(deps, INBOX.id, 't1', 'outsider', 'move_task');
  assert.equal(access.isAssignee, true);
  await assert.rejects(
    () => requireTaskDeleteAccess(deps, INBOX.id, 'outsider', 'delete_task'),
    ProjectNotFoundError,
  );
});
