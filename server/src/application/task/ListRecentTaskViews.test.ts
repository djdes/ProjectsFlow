import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ListRecentTaskViews } from './ListRecentTaskViews.js';

function makeList(activeWorkspace: { id: string; kind: 'default' | 'team' } | null): {
  list: ListRecentTaskViews;
  calls: { limit: number; workspaceId: string | undefined }[];
} {
  const calls: { limit: number; workspaceId: string | undefined }[] = [];
  const list = new ListRecentTaskViews({
    repo: {
      listRecent: async (_userId: string, limit: number, workspaceId?: string) => {
        calls.push({ limit, workspaceId });
        return [];
      },
    } as never,
    resolveActiveWorkspace: async () => activeWorkspace,
  });
  return { list, calls };
}

test('team workspace passes its id to the repo (scoped)', async () => {
  const { list, calls } = makeList({ id: 'ws-team', kind: 'team' });
  await list.execute('me', 5);
  assert.deepEqual(calls, [{ limit: 5, workspaceId: 'ws-team' }]);
});

test('default hub passes no workspaceId (all my recents)', async () => {
  const { list, calls } = makeList({ id: 'hub', kind: 'default' });
  await list.execute('me');
  // limit по умолчанию — 3.
  assert.deepEqual(calls, [{ limit: 3, workspaceId: undefined }]);
});

test('no active workspace yields empty list without hitting the repo', async () => {
  const { list, calls } = makeList(null);
  assert.deepEqual(await list.execute('me'), []);
  assert.deepEqual(calls, []);
});
