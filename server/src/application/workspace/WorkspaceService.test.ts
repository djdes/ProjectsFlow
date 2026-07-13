import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceService } from './WorkspaceService.js';
import type { WorkspaceRepository, CreateWorkspaceInput, UpdateWorkspaceInput, WorkspaceListItem } from './WorkspaceRepository.js';
import type { Workspace, WorkspaceKind } from '../../domain/workspace/Workspace.js';
import type { WorkspaceMember, WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
import {
  WorkspaceNameEmptyError,
  NotWorkspaceOwnerError,
  LastOwnerError,
  WorkspaceNotEmptyError,
  CannotDeleteLastWorkspaceError,
  CannotDeleteDefaultWorkspaceError,
  UserNotFoundByEmailError,
  NotProjectOwnerError,
} from '../../domain/workspace/errors.js';

type Seed = {
  workspaces?: Array<{ id: string; name?: string; ownerUserId: string; kind?: WorkspaceKind }>;
  members?: Array<{ workspaceId: string; userId: string; role: WorkspaceRole }>;
  current?: Record<string, string>; // userId -> workspaceId
  projects?: Array<{ id: string; ownerId: string; workspaceId: string }>;
  users?: Array<{ id: string; email: string }>;
};

function makeFakes(seed: Seed) {
  const workspaces = new Map<string, Workspace>();
  for (const w of seed.workspaces ?? []) {
    workspaces.set(w.id, { id: w.id, name: w.name ?? 'WS', icon: null, kind: w.kind ?? 'team', ownerUserId: w.ownerUserId, createdAt: new Date('2026-01-01') });
  }
  const members = (seed.members ?? []).map((m) => ({ ...m }));
  const current = new Map<string, string>(Object.entries(seed.current ?? {}));
  const projects = (seed.projects ?? []).map((p) => ({ ...p }));
  const users = seed.users ?? [];

  let idSeq = 0;
  const idGen = (): string => `ws-new-${++idSeq}`;

  const repo: WorkspaceRepository = {
    async listForUser(userId): Promise<WorkspaceListItem[]> {
      return members
        .filter((m) => m.userId === userId)
        .map((m) => {
          const w = workspaces.get(m.workspaceId)!;
          return {
            ...w,
            role: m.role,
            projectCount: projects.filter((p) => p.workspaceId === w.id).length,
            memberCount: members.filter((mm) => mm.workspaceId === w.id).length,
          };
        });
    },
    async getById(id) {
      return workspaces.get(id) ?? null;
    },
    async findDefaultForOwner(ownerUserId) {
      for (const w of workspaces.values()) {
        if (w.ownerUserId === ownerUserId && w.kind === 'default') return w.id;
      }
      return null;
    },
    async createWithOwnerMembership(input: CreateWorkspaceInput) {
      const w: Workspace = { id: input.id, name: input.name, icon: input.icon, kind: input.kind ?? 'team', ownerUserId: input.ownerUserId, createdAt: new Date('2026-01-02') };
      workspaces.set(w.id, w);
      members.push({ workspaceId: w.id, userId: input.ownerUserId, role: 'owner' });
      return w;
    },
    async update(id, patch: UpdateWorkspaceInput) {
      const w = workspaces.get(id);
      if (!w) return null;
      const next: Workspace = { ...w, name: patch.name ?? w.name, icon: patch.icon === undefined ? w.icon : patch.icon };
      workspaces.set(id, next);
      return next;
    },
    async delete(id) {
      workspaces.delete(id);
      for (let i = members.length - 1; i >= 0; i -= 1) if (members[i]!.workspaceId === id) members.splice(i, 1);
      for (const [u, w] of current) if (w === id) current.delete(u);
    },
    async countForUser(userId) {
      return members.filter((m) => m.userId === userId).length;
    },
    async projectCount(workspaceId) {
      return projects.filter((p) => p.workspaceId === workspaceId).length;
    },
    async getMembership(workspaceId, userId): Promise<WorkspaceMember | null> {
      return members.find((m) => m.workspaceId === workspaceId && m.userId === userId) ?? null;
    },
    async listMembers(workspaceId): Promise<WorkspaceMember[]> {
      return members.filter((m) => m.workspaceId === workspaceId);
    },
    async countOwners(workspaceId) {
      return members.filter((m) => m.workspaceId === workspaceId && m.role === 'owner').length;
    },
    async addMember(workspaceId, userId, role) {
      const existing = members.find((m) => m.workspaceId === workspaceId && m.userId === userId);
      if (existing) return;
      members.push({ workspaceId, userId, role });
    },
    async setMemberRole(workspaceId, userId, role) {
      const m = members.find((x) => x.workspaceId === workspaceId && x.userId === userId);
      if (m) m.role = role;
    },
    async removeMember(workspaceId, userId) {
      const i = members.findIndex((m) => m.workspaceId === workspaceId && m.userId === userId);
      if (i >= 0) members.splice(i, 1);
    },
    async setCurrentWorkspace(userId, workspaceId) {
      current.set(userId, workspaceId);
    },
    async getCurrentWorkspaceId(userId) {
      return current.get(userId) ?? null;
    },
    async findAnotherForUser(userId, excludeId) {
      const m = members.find((x) => x.userId === userId && x.workspaceId !== excludeId);
      return m?.workspaceId ?? null;
    },
    async findSoleTeamWorkspaceForUser(userId) {
      const teamIds = members
        .filter((m) => m.userId === userId)
        .map((m) => m.workspaceId)
        .filter((wid) => workspaces.get(wid)?.kind === 'team');
      return teamIds.length === 1 ? teamIds[0]! : null;
    },
  };

  const projectsPort = {
    async getById(id: string) {
      const p = projects.find((x) => x.id === id);
      return p ? { id: p.id, ownerId: p.ownerId } : null;
    },
    async getWorkspaceId(id: string) {
      return projects.find((x) => x.id === id)?.workspaceId ?? null;
    },
    async setWorkspace(projectId: string, workspaceId: string) {
      const p = projects.find((x) => x.id === projectId);
      if (p) p.workspaceId = workspaceId;
    },
    async listByWorkspace(workspaceId: string) {
      return projects.filter((p) => p.workspaceId === workspaceId).map((p) => ({ id: p.id, name: p.id, icon: null }));
    },
  };
  const usersPort = {
    async getByEmail(email: string) {
      const u = users.find((x) => x.email === email);
      return u ? { id: u.id } : null;
    },
  };

  const service = new WorkspaceService({ repo, projects: projectsPort, users: usersPort, idGen });
  return { service, repo, projects };
}

test('create: creates workspace, adds creator as owner, sets it current', async () => {
  const { service, repo } = makeFakes({ users: [{ id: 'u1', email: 'u1@x' }] });
  const ws = await service.create('u1', { name: '  Team  ', icon: null });
  assert.equal(ws.name, 'Team');
  assert.equal(await repo.getCurrentWorkspaceId('u1'), ws.id);
  assert.equal((await repo.getMembership(ws.id, 'u1'))?.role, 'owner');
});

test('create: empty name rejected', async () => {
  const { service } = makeFakes({});
  await assert.rejects(() => service.create('u1', { name: '   ', icon: null }), WorkspaceNameEmptyError);
});

test('rename: non-owner rejected', async () => {
  const { service } = makeFakes({
    workspaces: [{ id: 'w1', ownerUserId: 'u1' }],
    members: [{ workspaceId: 'w1', userId: 'u1', role: 'owner' }, { workspaceId: 'w1', userId: 'u2', role: 'editor' }],
  });
  await assert.rejects(() => service.rename('w1', 'u2', { name: 'x' }), NotWorkspaceOwnerError);
});

test('removeMember: cannot remove the last owner', async () => {
  const { service } = makeFakes({
    workspaces: [{ id: 'w1', ownerUserId: 'u1' }],
    members: [{ workspaceId: 'w1', userId: 'u1', role: 'owner' }],
  });
  await assert.rejects(() => service.removeMember('w1', 'u1', 'u1'), LastOwnerError);
});

test('changeMemberRole: demoting the last owner rejected', async () => {
  const { service } = makeFakes({
    workspaces: [{ id: 'w1', ownerUserId: 'u1' }],
    members: [{ workspaceId: 'w1', userId: 'u1', role: 'owner' }],
  });
  await assert.rejects(() => service.changeMemberRole('w1', 'u1', 'u1', 'editor'), LastOwnerError);
});

test('changeMemberRole: demoting the last owner to viewer rejected', async () => {
  const { service } = makeFakes({
    workspaces: [{ id: 'w1', ownerUserId: 'u1' }],
    members: [{ workspaceId: 'w1', userId: 'u1', role: 'owner' }],
  });
  await assert.rejects(() => service.changeMemberRole('w1', 'u1', 'u1', 'viewer'), LastOwnerError);
});

test('addMember: unknown email rejected', async () => {
  const { service } = makeFakes({
    workspaces: [{ id: 'w1', ownerUserId: 'u1' }],
    members: [{ workspaceId: 'w1', userId: 'u1', role: 'owner' }],
    users: [{ id: 'u1', email: 'u1@x' }],
  });
  await assert.rejects(() => service.addMember('w1', 'u1', 'nobody@x', 'editor'), UserNotFoundByEmailError);
});

test('addMember: adds existing user by email', async () => {
  const { service, repo } = makeFakes({
    workspaces: [{ id: 'w1', ownerUserId: 'u1' }],
    members: [{ workspaceId: 'w1', userId: 'u1', role: 'owner' }],
    users: [{ id: 'u1', email: 'u1@x' }, { id: 'u2', email: 'u2@x' }],
  });
  const m = await service.addMember('w1', 'u1', 'u2@x', 'editor');
  assert.equal(m.userId, 'u2');
  assert.equal((await repo.getMembership('w1', 'u2'))?.role, 'editor');
});

test('delete: workspace with projects rejected', async () => {
  const { service } = makeFakes({
    workspaces: [{ id: 'w1', ownerUserId: 'u1' }, { id: 'w2', ownerUserId: 'u1' }],
    members: [{ workspaceId: 'w1', userId: 'u1', role: 'owner' }, { workspaceId: 'w2', userId: 'u1', role: 'owner' }],
    projects: [{ id: 'p1', ownerId: 'u1', workspaceId: 'w1' }],
  });
  await assert.rejects(() => service.deleteWorkspace('w1', 'u1'), WorkspaceNotEmptyError);
});

test('delete: last workspace rejected', async () => {
  const { service } = makeFakes({
    workspaces: [{ id: 'w1', ownerUserId: 'u1' }],
    members: [{ workspaceId: 'w1', userId: 'u1', role: 'owner' }],
  });
  await assert.rejects(() => service.deleteWorkspace('w1', 'u1'), CannotDeleteLastWorkspaceError);
});

test('delete: empty non-last workspace deletes and auto-switches current', async () => {
  const { service, repo } = makeFakes({
    workspaces: [{ id: 'w1', ownerUserId: 'u1' }, { id: 'w2', ownerUserId: 'u1' }],
    members: [{ workspaceId: 'w1', userId: 'u1', role: 'owner' }, { workspaceId: 'w2', userId: 'u1', role: 'owner' }],
    current: { u1: 'w1' },
  });
  await service.deleteWorkspace('w1', 'u1');
  assert.equal(await repo.getById('w1'), null);
  assert.equal(await repo.getCurrentWorkspaceId('u1'), 'w2');
});

test('delete: default hub rejected even when empty and non-last', async () => {
  const { service } = makeFakes({
    workspaces: [{ id: 'w1', ownerUserId: 'u1', kind: 'default' }, { id: 'w2', ownerUserId: 'u1', kind: 'team' }],
    members: [{ workspaceId: 'w1', userId: 'u1', role: 'owner' }, { workspaceId: 'w2', userId: 'u1', role: 'owner' }],
    current: { u1: 'w2' },
  });
  await assert.rejects(() => service.deleteWorkspace('w1', 'u1'), CannotDeleteDefaultWorkspaceError);
});

test('create: manual create makes a team workspace, not a default hub', async () => {
  const { service } = makeFakes({ users: [{ id: 'u1', email: 'u1@x' }] });
  const ws = await service.create('u1', { name: 'Клиент', icon: null });
  assert.equal(ws.kind, 'team');
});

test('moveProject: non-owner of project rejected', async () => {
  const { service } = makeFakes({
    workspaces: [{ id: 'w1', ownerUserId: 'u1' }, { id: 'w2', ownerUserId: 'u1' }],
    members: [{ workspaceId: 'w1', userId: 'u1', role: 'owner' }, { workspaceId: 'w2', userId: 'u1', role: 'owner' }],
    projects: [{ id: 'p1', ownerId: 'other', workspaceId: 'w1' }],
  });
  await assert.rejects(() => service.moveProject('w1', 'u1', 'p1', 'w2'), NotProjectOwnerError);
});

test('moveProject: участники НЕ копируются — аудитория проекта = аудитория целевого пространства', async () => {
  const { service, repo, projects } = makeFakes({
    workspaces: [{ id: 'w1', ownerUserId: 'u1' }, { id: 'w2', ownerUserId: 'u1' }],
    members: [
      { workspaceId: 'w1', userId: 'u1', role: 'owner' },
      { workspaceId: 'w1', userId: 'u2', role: 'editor' }, // видел проект в w1
      { workspaceId: 'w2', userId: 'u1', role: 'owner' },
    ],
    projects: [{ id: 'p1', ownerId: 'u1', workspaceId: 'w1' }],
  });
  await service.moveProject('w1', 'u1', 'p1', 'w2');
  assert.equal(projects.find((p) => p.id === 'p1')?.workspaceId, 'w2');
  // u2 не перетащило в w2: он теряет доступ к p1 — задокументированное следствие модели.
  assert.deepEqual((await repo.listMembers('w2')).map((m) => m.userId), ['u1']);
});

test('moveProject: rejected when project is not in the source workspace', async () => {
  const { service } = makeFakes({
    workspaces: [{ id: 'w1', ownerUserId: 'u1' }, { id: 'w2', ownerUserId: 'u1' }, { id: 'w3', ownerUserId: 'u1' }],
    members: [
      { workspaceId: 'w1', userId: 'u1', role: 'owner' },
      { workspaceId: 'w2', userId: 'u1', role: 'owner' },
      { workspaceId: 'w3', userId: 'u1', role: 'owner' },
    ],
    // Проект лежит в w3, но переносим якобы из w1 — должно отлететь.
    projects: [{ id: 'p1', ownerId: 'u1', workspaceId: 'w3' }],
  });
  await assert.rejects(() => service.moveProject('w1', 'u1', 'p1', 'w2'));
});

test('switchCurrent: non-member rejected (404 not-found, no leak)', async () => {
  const { service } = makeFakes({
    workspaces: [{ id: 'w1', ownerUserId: 'u1' }],
    members: [{ workspaceId: 'w1', userId: 'u1', role: 'owner' }],
  });
  await assert.rejects(() => service.switchCurrent('intruder', 'w1'));
});
