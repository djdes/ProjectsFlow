import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SharedUser } from './ProjectMemberRepository.js';
import { ListSharedMembers } from './ListSharedMembers.js';

const shared = (ids: string[]): SharedUser[] =>
  ids.map((id) => ({ id, displayName: id, email: `${id}@example.com`, avatarUrl: null }));

function makeList(input: {
  hub: string[];
  inWorkspace?: string[];
  activeWorkspace?: { id: string; kind: 'default' | 'team' } | null;
}): { list: ListSharedMembers; askedWorkspace: string[] } {
  const askedWorkspace: string[] = [];
  const activeWorkspace =
    input.activeWorkspace === undefined ? { id: 'ws', kind: 'default' as const } : input.activeWorkspace;
  const list = new ListSharedMembers({
    members: {
      listSharedUsers: async () => shared(input.hub),
      listSharedUsersInWorkspace: async (_userId: string, workspaceId: string) => {
        askedWorkspace.push(workspaceId);
        return shared(input.inWorkspace ?? []);
      },
    } as never,
    resolveActiveWorkspace: async () => activeWorkspace,
  });
  return { list, askedWorkspace };
}

test('default hub returns all shared users across workspaces', async () => {
  const { list, askedWorkspace } = makeList({ hub: ['bob', 'carol'] });
  const users = await list.execute('me');
  assert.deepEqual(users.map((u) => u.id), ['bob', 'carol']);
  assert.deepEqual(askedWorkspace, []);
});

test('team workspace returns only that workspace co-members', async () => {
  const { list, askedWorkspace } = makeList({
    hub: ['bob', 'carol'],
    inWorkspace: ['bob'],
    activeWorkspace: { id: 'ws-team', kind: 'team' },
  });
  const users = await list.execute('me');
  assert.deepEqual(users.map((u) => u.id), ['bob']);
  assert.deepEqual(askedWorkspace, ['ws-team']);
});

test('no active workspace yields an empty member list', async () => {
  const { list } = makeList({ hub: ['bob'], activeWorkspace: null });
  assert.deepEqual(await list.execute('me'), []);
});
