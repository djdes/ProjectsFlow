import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HubMembershipSync } from './HubMembershipSync.js';

type ProjectSeed = { id: string; ownerId: string };

// Фейки: проекты, дефолт-хабы владельцев, членство хабов, общие проекты.
function makeFakes(opts: {
  projects: ProjectSeed[];
  hubs: Record<string, string>; // ownerId -> hubWorkspaceId
  sharedOwners?: Record<string, string[]>; // userId -> ownerIds, с кем ещё есть общий проект
}) {
  const hubMembers = new Set<string>(); // `${workspaceId}:${userId}`
  const key = (ws: string, u: string): string => `${ws}:${u}`;

  const projectsPort = {
    async getById(id: string) {
      return opts.projects.find((p) => p.id === id) ?? null;
    },
  };
  const membersPort = {
    async isMemberOfAnyProjectOwnedBy(userId: string, ownerUserId: string) {
      return (opts.sharedOwners?.[userId] ?? []).includes(ownerUserId);
    },
  };
  const workspacesPort = {
    async findDefaultForOwner(ownerUserId: string) {
      return opts.hubs[ownerUserId] ?? null;
    },
    async addMember(workspaceId: string, userId: string) {
      hubMembers.add(key(workspaceId, userId));
    },
    async removeMember(workspaceId: string, userId: string) {
      hubMembers.delete(key(workspaceId, userId));
    },
  };

  const sync = new HubMembershipSync({
    projects: projectsPort,
    members: membersPort,
    workspaces: workspacesPort,
  });
  return { sync, hubMembers, key };
}

test('onMemberAdded: collaborator joins owner hub', async () => {
  const { sync, hubMembers, key } = makeFakes({
    projects: [{ id: 'p1', ownerId: 'A' }],
    hubs: { A: 'hubA' },
  });
  await sync.onMemberAdded('p1', 'B');
  assert.ok(hubMembers.has(key('hubA', 'B')));
});

test('onMemberAdded: owner not re-added to own hub', async () => {
  const { sync, hubMembers } = makeFakes({
    projects: [{ id: 'p1', ownerId: 'A' }],
    hubs: { A: 'hubA' },
  });
  await sync.onMemberAdded('p1', 'A');
  assert.equal(hubMembers.size, 0);
});

test('onMemberRemoved: removed from hub when no shared projects remain', async () => {
  const { sync, hubMembers, key } = makeFakes({
    projects: [{ id: 'p1', ownerId: 'A' }],
    hubs: { A: 'hubA' },
    sharedOwners: { B: [] }, // у B больше нет общих проектов с A
  });
  hubMembers.add(key('hubA', 'B'));
  await sync.onMemberRemoved('p1', 'B');
  assert.ok(!hubMembers.has(key('hubA', 'B')));
});

test('onMemberRemoved: kept in hub while another shared project exists', async () => {
  const { sync, hubMembers, key } = makeFakes({
    projects: [{ id: 'p1', ownerId: 'A' }],
    hubs: { A: 'hubA' },
    sharedOwners: { B: ['A'] }, // B всё ещё в другом проекте A
  });
  hubMembers.add(key('hubA', 'B'));
  await sync.onMemberRemoved('p1', 'B');
  assert.ok(hubMembers.has(key('hubA', 'B')));
});

test('sync: no-op when owner has no default hub', async () => {
  const { sync, hubMembers } = makeFakes({
    projects: [{ id: 'p1', ownerId: 'A' }],
    hubs: {}, // у A нет дефолт-хаба
  });
  await sync.onMemberAdded('p1', 'B');
  assert.equal(hubMembers.size, 0);
});
