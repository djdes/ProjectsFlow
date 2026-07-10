import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AcceptTaskDelegation } from './AcceptTaskDelegation.js';

// --- Минимальные in-memory фейки (tsx + node:test, без новых deps) ---

const DELEGATE_ID = 'u-del';

function pendingDelegation() {
  return {
    id: 'd1',
    taskId: 't1',
    delegateUserId: DELEGATE_ID,
    delegateDisplayName: 'Делегат',
    creatorUserId: 'u-creator',
    creatorDisplayName: 'Создатель',
    status: 'pending' as const,
    createdAt: new Date(0),
    respondedAt: null,
    revertToUserId: null,
  };
}

type Harness = {
  accept: AcceptTaskDelegation;
  favoriteCalls: { projectId: string; userId: string; favorite: boolean }[];
};

function makeHarness(opts: {
  projectIsInbox: boolean;
  setFavoriteThrows?: boolean;
  taskMissing?: boolean;
}): Harness {
  const favoriteCalls: Harness['favoriteCalls'] = [];
  const updated = { ...pendingDelegation(), status: 'accepted' as const, respondedAt: new Date(0) };

  const accept = new AcceptTaskDelegation({
    delegations: {
      getById: async () => pendingDelegation(),
      setStatus: async () => updated,
    } as never,
    tasks: {
      getById: async () => (opts.taskMissing ? null : { id: 't1', projectId: 'p1' }),
    } as never,
    projects: {
      getById: async () => ({ id: 'p1', isInbox: opts.projectIsInbox }),
    } as never,
    members: {
      setFavorite: async (projectId: string, userId: string, favorite: boolean) => {
        if (opts.setFavoriteThrows) throw new Error('db boom');
        favoriteCalls.push({ projectId, userId, favorite });
      },
    } as never,
    users: {} as never,
    notifications: { create: async () => {} } as never,
    idGen: () => 'id-1',
  });

  return { accept, favoriteCalls };
}

test('accept в именованном проекте помечает проект favorite у делегата', async () => {
  const { accept, favoriteCalls } = makeHarness({ projectIsInbox: false });
  const result = await accept.execute('d1', DELEGATE_ID);
  assert.equal(result.status, 'accepted');
  assert.deepEqual(favoriteCalls, [{ projectId: 'p1', userId: DELEGATE_ID, favorite: true }]);
});

test('accept inbox-задачи не трогает favorite', async () => {
  const { accept, favoriteCalls } = makeHarness({ projectIsInbox: true });
  const result = await accept.execute('d1', DELEGATE_ID);
  assert.equal(result.status, 'accepted');
  assert.equal(favoriteCalls.length, 0);
});

test('accept не падает, если пометка favorite бросает (best-effort)', async () => {
  const { accept } = makeHarness({ projectIsInbox: false, setFavoriteThrows: true });
  const origError = console.error;
  console.error = () => {}; // глушим ожидаемый best-effort лог
  try {
    const result = await accept.execute('d1', DELEGATE_ID);
    assert.equal(result.status, 'accepted');
  } finally {
    console.error = origError;
  }
});
