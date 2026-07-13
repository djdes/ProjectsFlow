import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CreateWorkspaceInvite } from './CreateWorkspaceInvite.js';
import { AcceptWorkspaceInvite } from './AcceptWorkspaceInvite.js';
import { ListWorkspaceInvites } from './ListWorkspaceInvites.js';
import { DeleteWorkspaceInvite } from './DeleteWorkspaceInvite.js';
import type { WorkspaceInviteRepository } from './WorkspaceInviteRepository.js';
import type { WorkspaceInvite } from '../../domain/workspace/WorkspaceInvite.js';
import type { WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
import {
  NotWorkspaceEditorError,
  WorkspaceNotFoundError,
  WorkspaceInviteNotFoundError,
  WorkspaceInviteExpiredError,
  WorkspaceInviteAlreadyUsedError,
  CannotInviteToDefaultWorkspaceError,
} from '../../domain/workspace/errors.js';
import type { WorkspaceKind } from '../../domain/workspace/Workspace.js';

const NOW = new Date('2026-07-13T12:00:00Z');
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Seed = {
  members?: Array<{ workspaceId: string; userId: string; role: WorkspaceRole }>;
  users?: Array<{ id: string; email: string; displayName: string }>;
  invites?: WorkspaceInvite[];
  // По умолчанию все пространства из members — 'team' (не влияет на существующие тесты).
  // Указывай явно только для тестов гарда «нельзя пригласить в default».
  workspaceKinds?: Record<string, WorkspaceKind>;
  // Что возвращает мок absorbDefaultHubInto (реальная логика гейтов проверяется в
  // DrizzleWorkspaceRepository — тут важен только факт и аргументы вызова из accept).
  absorbResult?: boolean;
};

function makeFakes(seed: Seed = {}) {
  const members = (seed.members ?? []).map((m) => ({ ...m }));
  const users = seed.users ?? [];
  const invites = new Map<string, WorkspaceInvite>();
  for (const i of seed.invites ?? []) invites.set(i.id, i);
  const sentEmails: Array<{ to: string; subject: string }> = [];
  const notifications: Array<{ userId: string; payload: { type: string } }> = [];

  let seq = 0;
  const idGen = (): string => `id-${++seq}`;

  const invitesRepo: WorkspaceInviteRepository = {
    async create(input) {
      const invite: WorkspaceInvite = {
        ...input,
        acceptedAt: null,
        acceptedByUserId: null,
        createdAt: NOW,
      };
      invites.set(invite.id, invite);
      return invite;
    },
    async getById(id) {
      return invites.get(id) ?? null;
    },
    async findByToken(token) {
      for (const i of invites.values()) if (i.token === token) return i;
      return null;
    },
    async listPendingByWorkspace(workspaceId, now) {
      return [...invites.values()].filter(
        (i) => i.workspaceId === workspaceId && i.acceptedAt === null && i.expiresAt > now,
      );
    },
    async markAccepted({ inviteId, acceptedAt, acceptedByUserId }) {
      const i = invites.get(inviteId);
      if (!i) return null;
      const next = { ...i, acceptedAt, acceptedByUserId };
      invites.set(inviteId, next);
      return next;
    },
    async delete(id) {
      return invites.delete(id);
    },
  };

  const absorbCalls: Array<{ userId: string; targetWorkspaceId: string }> = [];
  const workspaces = {
    async getMembership(workspaceId: string, userId: string) {
      const m = members.find((x) => x.workspaceId === workspaceId && x.userId === userId);
      return m ? { workspaceId, userId, role: m.role } : null;
    },
    async addMember(workspaceId: string, userId: string, role: WorkspaceRole) {
      if (!members.find((x) => x.workspaceId === workspaceId && x.userId === userId)) {
        members.push({ workspaceId, userId, role });
      }
    },
    async getById(id: string) {
      const kind = seed.workspaceKinds?.[id] ?? 'team';
      return { id, name: 'Команда', kind };
    },
    async absorbDefaultHubInto(userId: string, targetWorkspaceId: string) {
      absorbCalls.push({ userId, targetWorkspaceId });
      return seed.absorbResult ?? true;
    },
  };
  const usersPort = {
    async getById(id: string) {
      const u = users.find((x) => x.id === id);
      return u ? { displayName: u.displayName } : null;
    },
    async getByEmail(email: string) {
      const u = users.find((x) => x.email === email);
      return u ? { id: u.id } : null;
    },
  };
  const emailPort = {
    async send(msg: { to: string; subject: string }) {
      sentEmails.push({ to: msg.to, subject: msg.subject });
    },
  };
  const notificationsPort = {
    async create(input: { id: string; userId: string; payload: { type: string } }) {
      notifications.push({ userId: input.userId, payload: input.payload });
      return input;
    },
  };

  const create = new CreateWorkspaceInvite({
    workspaces,
    invites: invitesRepo,
    users: usersPort,
    notifications: notificationsPort,
    email: emailPort,
    idGen,
    randomToken: () => 'a'.repeat(64),
    now: () => NOW,
    ttlMs: TTL_MS,
    appUrl: 'https://projectsflow.ru',
  });
  const accept = new AcceptWorkspaceInvite({
    invites: invitesRepo,
    workspaces,
    now: () => NOW,
  });
  const list = new ListWorkspaceInvites({
    workspaces,
    invites: invitesRepo,
    now: () => NOW,
  });
  const del = new DeleteWorkspaceInvite({ workspaces, invites: invitesRepo });

  return { create, accept, list, del, invitesRepo, workspaces, members, sentEmails, notifications, absorbCalls };
}

function pendingInvite(over: Partial<WorkspaceInvite> = {}): WorkspaceInvite {
  return {
    id: 'inv-1',
    workspaceId: 'w1',
    role: 'editor',
    token: 't'.repeat(64),
    email: null,
    expiresAt: new Date(NOW.getTime() + TTL_MS),
    acceptedAt: null,
    acceptedByUserId: null,
    createdByUserId: 'u1',
    createdAt: NOW,
    ...over,
  };
}

test('create: owner создаёт invite с TTL 7 дней и токеном', async () => {
  const { create } = makeFakes({ members: [{ workspaceId: 'w1', userId: 'u1', role: 'owner' }] });
  const { invite } = await create.execute({ workspaceId: 'w1', actorUserId: 'u1', role: 'editor', email: null });
  assert.equal(invite.workspaceId, 'w1');
  assert.equal(invite.token.length, 64);
  assert.equal(invite.expiresAt.getTime(), NOW.getTime() + TTL_MS);
});

test('create: viewer не может приглашать', async () => {
  const { create } = makeFakes({ members: [{ workspaceId: 'w1', userId: 'u3', role: 'viewer' }] });
  await assert.rejects(
    () => create.execute({ workspaceId: 'w1', actorUserId: 'u3', role: 'editor', email: null }),
    NotWorkspaceEditorError,
  );
});

test('create: editor тоже может приглашать (не только owner)', async () => {
  const { create } = makeFakes({ members: [{ workspaceId: 'w1', userId: 'u2', role: 'editor' }] });
  const { invite } = await create.execute({ workspaceId: 'w1', actorUserId: 'u2', role: 'viewer', email: null });
  assert.equal(invite.workspaceId, 'w1');
  assert.equal(invite.createdByUserId, 'u2');
});

test('create: не участник — 404-ошибка (не палим пространство)', async () => {
  const { create } = makeFakes({});
  await assert.rejects(
    () => create.execute({ workspaceId: 'w1', actorUserId: 'intruder', role: 'editor', email: null }),
    WorkspaceNotFoundError,
  );
});

test('create: в личный дефолт-хаб пригласить нельзя, даже owner', async () => {
  const { create } = makeFakes({
    members: [{ workspaceId: 'w1', userId: 'u1', role: 'owner' }],
    workspaceKinds: { w1: 'default' },
  });
  await assert.rejects(
    () => create.execute({ workspaceId: 'w1', actorUserId: 'u1', role: 'editor', email: null }),
    CannotInviteToDefaultWorkspaceError,
  );
});

test('create: в командное (kind=team) пространство приглашать можно (гард не мешает)', async () => {
  const { create } = makeFakes({
    members: [{ workspaceId: 'w1', userId: 'u1', role: 'owner' }],
    workspaceKinds: { w1: 'team' },
  });
  const { invite } = await create.execute({ workspaceId: 'w1', actorUserId: 'u1', role: 'editor', email: null });
  assert.equal(invite.workspaceId, 'w1');
});

test('create с email: шлёт письмо + in-app workspace_invite зарегистрированному', async () => {
  const { create, sentEmails, notifications } = makeFakes({
    members: [{ workspaceId: 'w1', userId: 'u1', role: 'owner' }],
    users: [
      { id: 'u1', email: 'u1@x', displayName: 'Ярослав' },
      { id: 'u2', email: 'u2@x', displayName: 'Гость' },
    ],
  });
  await create.execute({ workspaceId: 'w1', actorUserId: 'u1', role: 'viewer', email: 'u2@x' });
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0]?.to, 'u2@x');
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.userId, 'u2');
  assert.equal(notifications[0]?.payload.type, 'workspace_invite');
});

test('accept: зачисляет в пространство с ролью инвайта и потребляет токен', async () => {
  const { accept, workspaces, invitesRepo } = makeFakes({ invites: [pendingInvite()] });
  const res = await accept.execute('t'.repeat(64), 'u2');
  assert.equal(res.workspaceId, 'w1');
  assert.equal((await workspaces.getMembership('w1', 'u2'))?.role, 'editor');
  assert.ok((await invitesRepo.getById('inv-1'))?.acceptedAt);
});

test('accept: уже участник — роль не меняется, токен потребляется', async () => {
  const { accept, workspaces, invitesRepo } = makeFakes({
    members: [{ workspaceId: 'w1', userId: 'u2', role: 'owner' }],
    invites: [pendingInvite({ role: 'viewer' })],
  });
  await accept.execute('t'.repeat(64), 'u2');
  assert.equal((await workspaces.getMembership('w1', 'u2'))?.role, 'owner');
  assert.ok((await invitesRepo.getById('inv-1'))?.acceptedAt);
});

test('accept: мёржит личный дефолт-хаб юзера в целевое пространство (durability)', async () => {
  const { accept, absorbCalls } = makeFakes({ invites: [pendingInvite()] });
  await accept.execute('t'.repeat(64), 'u2');
  assert.deepEqual(absorbCalls, [{ userId: 'u2', targetWorkspaceId: 'w1' }]);
});

test('accept: absorb вызывается даже если юзер уже был участником (чинит вступивших до фичи)', async () => {
  const { accept, absorbCalls } = makeFakes({
    members: [{ workspaceId: 'w1', userId: 'u2', role: 'owner' }],
    invites: [pendingInvite({ role: 'viewer' })],
  });
  await accept.execute('t'.repeat(64), 'u2');
  assert.deepEqual(absorbCalls, [{ userId: 'u2', targetWorkspaceId: 'w1' }]);
});

test('accept: результат absorb (true/false) не влияет на успех accept — no-op тоже ок', async () => {
  const { accept, invitesRepo } = makeFakes({
    invites: [pendingInvite()],
    absorbResult: false,
  });
  const res = await accept.execute('t'.repeat(64), 'u2');
  assert.equal(res.workspaceId, 'w1');
  assert.ok((await invitesRepo.getById('inv-1'))?.acceptedAt);
});

test('accept: неизвестный токен → WorkspaceInviteNotFoundError', async () => {
  const { accept } = makeFakes({});
  await assert.rejects(() => accept.execute('nope', 'u2'), WorkspaceInviteNotFoundError);
});

test('accept: просроченный → WorkspaceInviteExpiredError', async () => {
  const { accept } = makeFakes({
    invites: [pendingInvite({ expiresAt: new Date(NOW.getTime() - 1000) })],
  });
  await assert.rejects(() => accept.execute('t'.repeat(64), 'u2'), WorkspaceInviteExpiredError);
});

test('accept: использованный → WorkspaceInviteAlreadyUsedError', async () => {
  const { accept } = makeFakes({
    invites: [pendingInvite({ acceptedAt: NOW, acceptedByUserId: 'u9' })],
  });
  await assert.rejects(() => accept.execute('t'.repeat(64), 'u2'), WorkspaceInviteAlreadyUsedError);
});

test('list: owner видит только pending', async () => {
  const { list } = makeFakes({
    members: [{ workspaceId: 'w1', userId: 'u1', role: 'owner' }],
    invites: [
      pendingInvite(),
      pendingInvite({ id: 'inv-2', token: 'u'.repeat(64), acceptedAt: NOW }),
      pendingInvite({ id: 'inv-3', token: 'v'.repeat(64), expiresAt: new Date(NOW.getTime() - 1) }),
    ],
  });
  const items = await list.execute('w1', 'u1');
  assert.deepEqual(items.map((i) => i.id), ['inv-1']);
});

test('list: viewer не видит инвайты', async () => {
  const { list } = makeFakes({
    members: [{ workspaceId: 'w1', userId: 'u3', role: 'viewer' }],
    invites: [pendingInvite()],
  });
  await assert.rejects(() => list.execute('w1', 'u3'), NotWorkspaceEditorError);
});

test('list: editor тоже видит pending (не только owner)', async () => {
  const { list } = makeFakes({
    members: [{ workspaceId: 'w1', userId: 'u2', role: 'editor' }],
    invites: [pendingInvite()],
  });
  const items = await list.execute('w1', 'u2');
  assert.deepEqual(items.map((i) => i.id), ['inv-1']);
});

test('delete: owner отзывает invite; чужой inviteId → not found', async () => {
  const { del, invitesRepo } = makeFakes({
    members: [{ workspaceId: 'w1', userId: 'u1', role: 'owner' }],
    invites: [pendingInvite(), pendingInvite({ id: 'inv-other', workspaceId: 'w2', token: 'z'.repeat(64) })],
  });
  await del.execute('w1', 'u1', 'inv-1');
  assert.equal(await invitesRepo.getById('inv-1'), null);
  await assert.rejects(() => del.execute('w1', 'u1', 'inv-other'), WorkspaceInviteNotFoundError);
});

test('delete: editor тоже может отзывать (не только owner)', async () => {
  const { del, invitesRepo } = makeFakes({
    members: [{ workspaceId: 'w1', userId: 'u2', role: 'editor' }],
    invites: [pendingInvite()],
  });
  await del.execute('w1', 'u2', 'inv-1');
  assert.equal(await invitesRepo.getById('inv-1'), null);
});

test('delete: viewer не может отзывать', async () => {
  const { del } = makeFakes({
    members: [{ workspaceId: 'w1', userId: 'u3', role: 'viewer' }],
    invites: [pendingInvite()],
  });
  await assert.rejects(() => del.execute('w1', 'u3', 'inv-1'), NotWorkspaceEditorError);
});
