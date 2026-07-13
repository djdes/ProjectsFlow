import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import { workspacesRouter } from './routes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { WorkspaceService } from '../../application/workspace/WorkspaceService.js';
import { CreateWorkspaceInvite } from '../../application/workspace/CreateWorkspaceInvite.js';
import { ListWorkspaceInvites } from '../../application/workspace/ListWorkspaceInvites.js';
import { DeleteWorkspaceInvite } from '../../application/workspace/DeleteWorkspaceInvite.js';
import type { WorkspaceRepository } from '../../application/workspace/WorkspaceRepository.js';
import type { WorkspaceInviteRepository } from '../../application/workspace/WorkspaceInviteRepository.js';
import type { Workspace } from '../../domain/workspace/Workspace.js';
import type { WorkspaceMember, WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
import type { WorkspaceInvite } from '../../domain/workspace/WorkspaceInvite.js';
import type { User } from '../../domain/user/User.js';

const NOW = new Date('2026-07-13T12:00:00Z');

type Seed = {
  workspaces?: Array<{ id: string; ownerUserId: string }>;
  members?: Array<{ workspaceId: string; userId: string; role: WorkspaceRole }>;
};

function makeWorkspaceRepo(seed: Seed): WorkspaceRepository {
  const workspaces = new Map<string, Workspace>();
  for (const w of seed.workspaces ?? []) {
    workspaces.set(w.id, { id: w.id, name: 'WS', icon: null, kind: 'team', ownerUserId: w.ownerUserId, createdAt: NOW });
  }
  const members = (seed.members ?? []).map((m) => ({ ...m }));

  return {
    async listForUser() {
      return [];
    },
    async getById(id) {
      return workspaces.get(id) ?? null;
    },
    async findDefaultForOwner() {
      return null;
    },
    async createWithOwnerMembership() {
      throw new Error('not used');
    },
    async update() {
      return null;
    },
    async delete() {},
    async countForUser() {
      return 0;
    },
    async projectCount() {
      return 0;
    },
    async getMembership(workspaceId, userId): Promise<WorkspaceMember | null> {
      const m = members.find((x) => x.workspaceId === workspaceId && x.userId === userId);
      return m ? { ...m, displayName: null, email: null, avatarUrl: null } : null;
    },
    async listMembers(workspaceId): Promise<WorkspaceMember[]> {
      return members
        .filter((m) => m.workspaceId === workspaceId)
        .map((m) => ({ ...m, displayName: null, email: null, avatarUrl: null }));
    },
    async countOwners(workspaceId) {
      return members.filter((m) => m.workspaceId === workspaceId && m.role === 'owner').length;
    },
    async addMember(workspaceId, userId, role) {
      if (members.some((m) => m.workspaceId === workspaceId && m.userId === userId)) return;
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
    async setCurrentWorkspace() {},
    async getCurrentWorkspaceId() {
      return null;
    },
    async findAnotherForUser() {
      return null;
    },
    async findSoleTeamWorkspaceForUser(userId) {
      const teamIds = members
        .filter((m) => m.userId === userId)
        .map((m) => m.workspaceId)
        .filter((wid) => workspaces.get(wid)?.kind === 'team');
      return teamIds.length === 1 ? teamIds[0]! : null;
    },
  };
}

function makeInviteRepo(): { repo: WorkspaceInviteRepository; store: Map<string, WorkspaceInvite> } {
  const store = new Map<string, WorkspaceInvite>();
  const repo: WorkspaceInviteRepository = {
    async create(input) {
      const invite: WorkspaceInvite = {
        ...input,
        acceptedAt: null,
        acceptedByUserId: null,
        createdAt: NOW,
      };
      store.set(invite.id, invite);
      return invite;
    },
    async getById(id) {
      return store.get(id) ?? null;
    },
    async findByToken(token) {
      for (const i of store.values()) if (i.token === token) return i;
      return null;
    },
    async listPendingByWorkspace(workspaceId, now) {
      return [...store.values()].filter(
        (i) => i.workspaceId === workspaceId && i.acceptedAt === null && i.expiresAt > now,
      );
    },
    async markAccepted(input) {
      const i = store.get(input.inviteId);
      if (!i) return null;
      const updated = { ...i, acceptedAt: input.acceptedAt, acceptedByUserId: input.acceptedByUserId };
      store.set(i.id, updated);
      return updated;
    },
    async delete(id) {
      return store.delete(id);
    },
  };
  return { repo, store };
}

function buildApp(seed: Seed) {
  const repo = makeWorkspaceRepo(seed);
  const { repo: inviteRepo } = makeInviteRepo();
  const service = new WorkspaceService({
    repo,
    projects: {
      async getById() {
        return null;
      },
      async getWorkspaceId() {
        return null;
      },
      async setWorkspace() {},
      async listByWorkspace() {
        return [];
      },
    },
    projectMembers: {
      async listByProject() {
        return [];
      },
    },
    users: {
      async getByEmail() {
        return null;
      },
    },
    idGen: () => 'gen-id',
  });

  let inviteSeq = 0;
  const invites = {
    create: new CreateWorkspaceInvite({
      workspaces: repo,
      invites: inviteRepo,
      users: { async getById() { return { displayName: 'Актор' }; }, async getByEmail() { return null; } },
      notifications: { async create() {} },
      email: { async send() {} },
      idGen: () => `invite-${++inviteSeq}`,
      randomToken: () => `token-${inviteSeq}`,
      now: () => NOW,
      ttlMs: 7 * 24 * 60 * 60 * 1000,
      appUrl: 'https://app.test',
    }),
    list: new ListWorkspaceInvites({ workspaces: repo, invites: inviteRepo, now: () => NOW }),
    delete: new DeleteWorkspaceInvite({ workspaces: repo, invites: inviteRepo }),
  };

  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const userId = req.header('x-test-user');
    if (userId) {
      req.user = { id: userId, email: `${userId}@test.dev`, displayName: userId, avatarUrl: null, isAdmin: false, createdAt: NOW } as User;
    }
    next();
  });
  app.use('/api/workspaces', workspacesRouter({ service, invites, appUrl: 'https://app.test' }));
  app.use(errorHandler);
  return app;
}

async function withServer(seed: Seed, fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = http.createServer(buildApp(seed));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    const { port } = server.address() as AddressInfo;
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

test('POST /:id/invites — полная форма DTO с token+url только в ответе create', async () => {
  await withServer(
    {
      workspaces: [{ id: 'w1', ownerUserId: 'owner1' }],
      members: [{ workspaceId: 'w1', userId: 'owner1', role: 'owner' }],
    },
    async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/workspaces/w1/invites`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-user': 'owner1' },
        body: JSON.stringify({ role: 'editor', email: 'friend@test.dev' }),
      });
      assert.equal(res.status, 201);
      const body = (await res.json()) as { invite: Record<string, unknown> };
      assert.deepEqual(Object.keys(body.invite).sort(), [
        'acceptedAt',
        'acceptedByUserId',
        'createdAt',
        'createdByUserId',
        'email',
        'expiresAt',
        'id',
        'role',
        'token',
        'url',
        'workspaceId',
      ]);
      assert.equal(body.invite['workspaceId'], 'w1');
      assert.equal(body.invite['role'], 'editor');
      assert.equal(body.invite['email'], 'friend@test.dev');
      assert.equal(body.invite['acceptedAt'], null);
      assert.equal(body.invite['acceptedByUserId'], null);
      assert.equal(body.invite['createdByUserId'], 'owner1');
      assert.equal(body.invite['url'], `https://app.test/invite/${body.invite['token']}`);
    },
  );
});

test('GET /:id/invites — список без token/url', async () => {
  await withServer(
    {
      workspaces: [{ id: 'w1', ownerUserId: 'owner1' }],
      members: [{ workspaceId: 'w1', userId: 'owner1', role: 'owner' }],
    },
    async (baseUrl) => {
      await fetch(`${baseUrl}/api/workspaces/w1/invites`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-user': 'owner1' },
        body: JSON.stringify({ role: 'viewer' }),
      });
      const res = await fetch(`${baseUrl}/api/workspaces/w1/invites`, {
        headers: { 'x-test-user': 'owner1' },
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { invites: Array<Record<string, unknown>> };
      assert.equal(body.invites.length, 1);
      assert.equal('token' in body.invites[0]!, false);
      assert.equal('url' in body.invites[0]!, false);
    },
  );
});

test('POST /:id/invites — viewer не может приглашать (403 not_workspace_editor)', async () => {
  await withServer(
    {
      workspaces: [{ id: 'w1', ownerUserId: 'owner1' }],
      members: [
        { workspaceId: 'w1', userId: 'owner1', role: 'owner' },
        { workspaceId: 'w1', userId: 'viewer1', role: 'viewer' },
      ],
    },
    async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/workspaces/w1/invites`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-user': 'viewer1' },
        body: JSON.stringify({ role: 'editor' }),
      });
      assert.equal(res.status, 403);
      const body = (await res.json()) as { error?: string };
      assert.equal(body.error, 'not_workspace_editor');
    },
  );
});

test('DELETE /:id/invites/:inviteId — отзыв инвайта owner-ом', async () => {
  await withServer(
    {
      workspaces: [{ id: 'w1', ownerUserId: 'owner1' }],
      members: [{ workspaceId: 'w1', userId: 'owner1', role: 'owner' }],
    },
    async (baseUrl) => {
      const created = await fetch(`${baseUrl}/api/workspaces/w1/invites`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-user': 'owner1' },
        body: JSON.stringify({ role: 'editor' }),
      });
      const { invite } = (await created.json()) as { invite: { id: string } };
      const res = await fetch(`${baseUrl}/api/workspaces/w1/invites/${invite.id}`, {
        method: 'DELETE',
        headers: { 'x-test-user': 'owner1' },
      });
      assert.equal(res.status, 204);
      const list = await fetch(`${baseUrl}/api/workspaces/w1/invites`, {
        headers: { 'x-test-user': 'owner1' },
      });
      const { invites } = (await list.json()) as { invites: unknown[] };
      assert.equal(invites.length, 0);
    },
  );
});

test('PATCH /:id/members/:userId — понижение последнего owner отклонено 409 workspace_last_owner', async () => {
  await withServer(
    {
      workspaces: [{ id: 'w1', ownerUserId: 'owner1' }],
      members: [{ workspaceId: 'w1', userId: 'owner1', role: 'owner' }],
    },
    async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/workspaces/w1/members/owner1`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-test-user': 'owner1' },
        body: JSON.stringify({ role: 'editor' }),
      });
      assert.equal(res.status, 409);
      const body = (await res.json()) as { error?: string };
      assert.equal(body.error, 'workspace_last_owner');
    },
  );
});

test('DELETE /:id/members/:userId — удаление последнего owner отклонено 409 workspace_last_owner', async () => {
  await withServer(
    {
      workspaces: [{ id: 'w1', ownerUserId: 'owner1' }],
      members: [{ workspaceId: 'w1', userId: 'owner1', role: 'owner' }],
    },
    async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/workspaces/w1/members/owner1`, {
        method: 'DELETE',
        headers: { 'x-test-user': 'owner1' },
      });
      assert.equal(res.status, 409);
      const body = (await res.json()) as { error?: string };
      assert.equal(body.error, 'workspace_last_owner');
    },
  );
});

test('PATCH /:id/members/:userId — понижение одного из двух owner-ов проходит', async () => {
  await withServer(
    {
      workspaces: [{ id: 'w1', ownerUserId: 'owner1' }],
      members: [
        { workspaceId: 'w1', userId: 'owner1', role: 'owner' },
        { workspaceId: 'w1', userId: 'owner2', role: 'owner' },
      ],
    },
    async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/workspaces/w1/members/owner2`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-test-user': 'owner1' },
        body: JSON.stringify({ role: 'editor' }),
      });
      assert.equal(res.status, 204);
    },
  );
});
