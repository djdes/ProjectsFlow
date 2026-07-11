import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MoveTaskToProject } from './MoveTaskToProject.js';
import { TargetProjectIsInboxError } from '../../domain/task/errors.js';

// Фейки по образцу AcceptTaskDelegation.test.ts. Покрывается НОВАЯ ветка: перенос задачи
// именованного проекта в СВОЙ инбокс (drag пилюли на нижнюю доску «Входящих»). Чужой
// инбокс — по-прежнему TargetProjectIsInboxError. Полная матрица прав requireProjectAccess
// покрыта её собственными тестами.

const ME = 'u-me';
const OTHER = 'u-other';
const SOURCE = 'p-named';
const MY_INBOX = 'p-my-inbox';

function makeHarness(opts: { inboxOwnerId: string; delegateUserId?: string }): {
  move: MoveTaskToProject;
  movedTo: string[];
  archived: string[];
  notified: number;
} {
  const movedTo: string[] = [];
  const archived: string[] = [];
  const counters = { notified: 0 };
  const active = opts.delegateUserId
    ? { id: 'd1', taskId: 't1', delegateUserId: opts.delegateUserId, status: 'accepted' as const }
    : null;

  const move = new MoveTaskToProject({
    tasks: {
      getById: async () => ({ id: 't1', projectId: SOURCE, description: 'x' }),
      moveToProject: async (taskId: string, target: string) => {
        movedTo.push(target);
        return { id: taskId, projectId: target, description: 'x' };
      },
    } as never,
    projects: {
      getById: async (id: string) =>
        id === SOURCE
          ? { id: SOURCE, isInbox: false, ownerId: OTHER, name: 'Проект' }
          : { id, isInbox: true, ownerId: opts.inboxOwnerId, name: 'Входящие' },
    } as never,
    // requireProjectAccess источника: caller — editor источника.
    members: {
      findForProject: async (_p: string, u: string) =>
        u === ME ? { role: 'editor' } : null,
    } as never,
    delegations: {
      findActiveForTask: async () => active,
      setStatus: async (id: string) => {
        archived.push(id);
        return active;
      },
    } as never,
    users: {
      getById: async (id: string) => {
        counters.notified += 1;
        return { id, email: 'x@x', displayName: 'X' };
      },
    } as never,
    notifications: { create: async () => {} } as never,
    email: { send: async () => {} } as never,
    idGen: () => 'id-1',
    appUrl: 'https://example.test',
  });

  return {
    move,
    movedTo,
    archived,
    get notified() {
      return counters.notified;
    },
  };
}

const flushAsync = async (): Promise<void> => new Promise((r) => setImmediate(r));

test('перенос задачи проекта в СВОЙ инбокс разрешён; свою делегацию архивирует без notify', async () => {
  const h = makeHarness({ inboxOwnerId: ME, delegateUserId: ME });
  const moved = await h.move.execute('t1', MY_INBOX, ME);
  await flushAsync();
  assert.equal(moved.projectId, MY_INBOX);
  assert.deepEqual(h.movedTo, [MY_INBOX]);
  assert.deepEqual(h.archived, ['d1']); // делегация archived
  assert.equal(h.notified, 0); // делегат == caller — себя не уведомляем
});

test('перенос в ЧУЖОЙ инбокс запрещён (TargetProjectIsInboxError)', async () => {
  const h = makeHarness({ inboxOwnerId: OTHER });
  await assert.rejects(() => h.move.execute('t1', 'p-foreign-inbox', ME), TargetProjectIsInboxError);
  assert.equal(h.movedTo.length, 0);
});

test('делегация на ДРУГОГО при переносе архивируется и делегат уведомляется', async () => {
  const h = makeHarness({ inboxOwnerId: ME, delegateUserId: OTHER });
  await h.move.execute('t1', MY_INBOX, ME);
  await flushAsync();
  assert.deepEqual(h.archived, ['d1']);
  assert.ok(h.notified > 0);
});
