import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ListProjects } from './ListProjects.js';
import type { ProjectMemberRepository, ProjectWithRole } from './ProjectMemberRepository.js';
import type { WorkspaceKind } from '../../domain/workspace/Workspace.js';

// Минимальный фейк: фиксируем, какой именно метод дёрнул ListProjects.
function makeMembers(): { repo: ProjectMemberRepository; calls: string[] } {
  const calls: string[] = [];
  const stub = (id: string): ProjectWithRole[] => [
    {
      id,
      ownerId: 'owner',
      name: id,
      icon: null,
      status: 'active',
      gitRepoUrl: null,
      kbRepoFullName: null,
      isInbox: false,
      kbKind: 'none',
      financeVisibility: 'owner_only',
      dispatcherUserId: null,
      multiTaskWorker: false,
      publicSlug: null,
      isPublic: false,
      publicIndexing: false,
      createdAt: new Date('2026-01-01'),
      role: 'owner',
      memberCount: 1,
      taskCount: 0,
      isFavorite: false,
      favoriteSortOrder: 0,
    },
  ];
  const repo = {
    async listProjectsForUser(userId: string) {
      calls.push(`all:${userId}`);
      return stub('aggregated');
    },
    async listProjectsForUserInWorkspace(userId: string, workspaceId: string) {
      calls.push(`ws:${userId}:${workspaceId}`);
      return stub('scoped');
    },
  } as unknown as ProjectMemberRepository;
  return { repo, calls };
}

function withActive(kind: WorkspaceKind | null, id = 'ws1') {
  return async (_userId: string) => (kind ? { id, kind } : null);
}

test('default hub → aggregates ALL my projects (ignores workspace_id)', async () => {
  const { repo, calls } = makeMembers();
  const uc = new ListProjects({ members: repo, resolveActiveWorkspace: withActive('default') });
  const out = await uc.execute('u1');
  assert.deepEqual(calls, ['all:u1']);
  assert.equal(out[0]?.id, 'aggregated');
});

test('team workspace → slice scoped to that workspace', async () => {
  const { repo, calls } = makeMembers();
  const uc = new ListProjects({ members: repo, resolveActiveWorkspace: withActive('team', 'team-1') });
  const out = await uc.execute('u1');
  assert.deepEqual(calls, ['ws:u1:team-1']);
  assert.equal(out[0]?.id, 'scoped');
});

test('no active workspace → empty list, no repo calls', async () => {
  const { repo, calls } = makeMembers();
  const uc = new ListProjects({ members: repo, resolveActiveWorkspace: withActive(null) });
  const out = await uc.execute('u1');
  assert.deepEqual(out, []);
  assert.deepEqual(calls, []);
});
