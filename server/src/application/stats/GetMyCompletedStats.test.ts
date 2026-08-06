import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GetMyCompletedStats, RECENT_WINDOW_DAYS } from './GetMyCompletedStats.js';

const NOW = new Date('2026-08-06T12:00:00.000Z');

function make(seed: {
  workspaces?: Array<{ id: string; name: string }>;
  done?: Array<{ workspaceId: string; count: number }>;
  recent?: Array<{ workspaceId: string; count: number }>;
}) {
  const sinceCalls: Date[] = [];
  const uc = new GetMyCompletedStats({
    workspaces: {
      listForUser: async () => (seed.workspaces ?? []) as never,
    } as never,
    tasks: {
      countDoneByWorkspaceForAssignee: async () => seed.done ?? [],
    } as never,
    activity: {
      countCompletedByActorPerWorkspaceSince: async (_userId: string, since: Date) => {
        sinceCalls.push(since);
        return seed.recent ?? [];
      },
    } as never,
    now: () => NOW,
  });
  return { uc, sinceCalls };
}

test('склеивает две цифры на пространство и сортирует по «всего»', async () => {
  const h = make({
    workspaces: [
      { id: 'w1', name: 'Команда' },
      { id: 'w2', name: 'Личный хаб' },
    ],
    done: [
      { workspaceId: 'w1', count: 4 },
      { workspaceId: 'w2', count: 11 },
    ],
    recent: [{ workspaceId: 'w1', count: 3 }],
  });

  assert.deepEqual(await h.uc.execute('u1'), [
    { workspaceId: 'w2', name: 'Личный хаб', doneTotal: 11, completedRecent: 0 },
    { workspaceId: 'w1', name: 'Команда', doneTotal: 4, completedRecent: 3 },
  ]);
});

test('пространство без выполненных задач показывается нулями, а не пропадает', async () => {
  const h = make({ workspaces: [{ id: 'w1', name: 'Пустое' }] });

  assert.deepEqual(await h.uc.execute('u1'), [
    { workspaceId: 'w1', name: 'Пустое', doneTotal: 0, completedRecent: 0 },
  ]);
});

test('пространства, где юзер уже не участник, в выдачу не попадают', async () => {
  // Задачи за ним там ещё числятся, но показывать чужое пространство нельзя.
  const h = make({
    workspaces: [{ id: 'w1', name: 'Своё' }],
    done: [
      { workspaceId: 'w1', count: 1 },
      { workspaceId: 'w-foreign', count: 99 },
    ],
  });

  const rows = await h.uc.execute('u1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.workspaceId, 'w1');
});

test('окно журнала — последние 30 дней от «сейчас»', async () => {
  const h = make({ workspaces: [] });
  await h.uc.execute('u1');

  const expected = new Date(NOW.getTime() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  assert.equal(h.sinceCalls[0]?.toISOString(), expected.toISOString());
});
