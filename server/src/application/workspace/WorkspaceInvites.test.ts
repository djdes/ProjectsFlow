import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeliverWorkspaceInvites } from './DeliverWorkspaceInvites.js';
import { ManageWorkspaceInvite } from './ManageWorkspaceInvite.js';
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
  NotWorkspaceLeadError,
  WorkspaceInviteMemberExistsError,
  WorkspaceInviteCooldownError,
} from '../../domain/workspace/errors.js';
import type { WorkspaceKind } from '../../domain/workspace/Workspace.js';

const NOW = new Date('2026-07-13T12:00:00Z');
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Seed = {
  excluded?: Array<{ projectId: string; userId: string }>;
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
  const exclusions = [...(seed.excluded ?? [])];
  const members = (seed.members ?? []).map((m) => ({ ...m }));
  const users = seed.users ?? [];
  const invites = new Map<string, WorkspaceInvite>();
  for (const i of seed.invites ?? []) invites.set(i.id, i);
  const sentEmails: Array<{ to: string; subject: string }> = [];
  const notifications: Array<{ userId: string; payload: { type: string } }> = [];

  let seq = 0;
  const idGen = (): string => `id-${++seq}`;

  const invitesRepo: WorkspaceInviteRepository = {
    async acceptWithMembership({ inviteId, acceptedAt, acceptedByUserId }) {
      const invite = invites.get(inviteId);
      if (!invite) throw new WorkspaceInviteNotFoundError();
      if (invite.acceptedAt) throw new WorkspaceInviteAlreadyUsedError();
      if (invite.expiresAt <= acceptedAt) throw new WorkspaceInviteExpiredError();
      if (!members.some((m) => m.workspaceId === invite.workspaceId && m.userId === acceptedByUserId)) {
        members.push({ workspaceId: invite.workspaceId, userId: acceptedByUserId, role: invite.role });
        exclusions.push(...(invite.excludedProjectIds ?? []).map((projectId) => ({ projectId, userId: acceptedByUserId })));
      }
      invites.set(invite.id, { ...invite, acceptedAt, acceptedByUserId });
    },
    async claimDelivery(now) {
      const row = [...invites.values()].find(i => i.deliveryNextAttemptAt && i.deliveryNextAttemptAt <= now && !i.deliveryLockedAt && !i.acceptedAt);
      if (!row) return null;
      const claimed = { ...row, deliveryLockedAt: now, lastSentAt: now, deliveryAttempts: (row.deliveryAttempts ?? 0) + 1 };
      invites.set(row.id, claimed); return claimed;
    },
    async finishDelivery(id, _claimedAt, delivery, nextAttemptAt) {
      const row = invites.get(id); if (row) invites.set(id, { ...row, delivery, deliveryNextAttemptAt: nextAttemptAt, deliveryLockedAt: null });
    },
    async rescheduleDelivery(id, now, expiresAt) {
      const row = invites.get(id);
      if (!row || row.acceptedAt || (row.lastSentAt && now.getTime() - row.lastSentAt.getTime() < 60_000)) return null;
      const updated = { ...row, expiresAt, lastSentAt: now, delivery: { email: 'queued' as const, site: 'queued' as const, telegram: 'queued' as const }, deliveryAttempts: 0, deliveryNextAttemptAt: now, deliveryLockedAt: null };
      invites.set(id, updated); return updated;
    },
    async create(input) {
      const existing = input.email && [...invites.values()].find(i => !i.acceptedAt && i.workspaceId === input.workspaceId && i.email?.toLowerCase() === input.email?.toLowerCase());
      if (existing) return existing;

      const invite: WorkspaceInvite = {
        ...input,
        delivery: input.email ? { email: 'queued', site: 'queued', telegram: 'queued' } : null,
        deliveryNextAttemptAt: input.email ? input.queuedAt ?? NOW : null,
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
        (i) => i.workspaceId === workspaceId && i.acceptedAt === null,
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
    projectAccess: {
      listProjects: async () => [{ id: 'p1', name: 'One', icon: null }, { id: 'p2', name: 'Two', icon: null }],
      listExclusions: async () => exclusions,
    },
    workspaces,
    invites: invitesRepo,
    users: usersPort,
    idGen,
    randomToken: () => 'a'.repeat(64),
    now: () => NOW,
    ttlMs: TTL_MS,
  });
  const delivery = new DeliverWorkspaceInvites({ invites: invitesRepo, workspaces, users: usersPort,
    notifications: notificationsPort, email: emailPort, emailConfigured: true,
    telegram: { execute: async () => ({ status: 'not_connected' }) }, appUrl: 'https://projectsflow.ru', now: () => NOW });
  const manage = new ManageWorkspaceInvite({ invites: invitesRepo, workspaces, appUrl: 'https://projectsflow.ru', now: () => NOW, ttlMs: TTL_MS });
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

  return { create, delivery, manage, accept, list, del, invitesRepo, workspaces, members, sentEmails, notifications, absorbCalls, exclusions };
}

test('lead can invite with selected projects; acceptance persists restrictions', async () => {
  const { create, accept, exclusions } = makeFakes({ members: [{ workspaceId: 'w1', userId: 'lead', role: 'lead' }] });
  const { invite } = await create.execute({ workspaceId: 'w1', actorUserId: 'lead', role: 'editor', email: null, excludedProjectIds: ['p2'] });
  await accept.execute(invite.token, 'new');
  assert.deepEqual(exclusions, [{ projectId: 'p2', userId: 'new' }]);
});
test('editor invitations inherit restrictions but cannot supply a project selection', async () => {
  const { create } = makeFakes({ members: [{ workspaceId: 'w1', userId: 'ed', role: 'editor' }], excluded: [{ projectId: 'p2', userId: 'ed' }] });
  await assert.rejects(create.execute({ workspaceId: 'w1', actorUserId: 'ed', role: 'editor', email: null, excludedProjectIds: ['p1'] }), NotWorkspaceLeadError);
  const { invite } = await create.execute({ workspaceId: 'w1', actorUserId: 'ed', role: 'editor', email: null });
  assert.deepEqual(invite.excludedProjectIds, ['p2']);
});
test('a second invitation does not overwrite an existing member visibility', async () => {
  const { create, accept, exclusions } = makeFakes({ members: [{ workspaceId: 'w1', userId: 'owner', role: 'owner' }, { workspaceId: 'w1', userId: 'existing', role: 'editor' }], excluded: [{ projectId: 'p1', userId: 'existing' }] });
  const { invite } = await create.execute({ workspaceId: 'w1', actorUserId: 'owner', role: 'viewer', email: null, excludedProjectIds: ['p2'] });
  await accept.execute(invite.token, 'existing');
  assert.deepEqual(exclusions, [{ projectId: 'p1', userId: 'existing' }]);
});

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
  const { create, delivery, sentEmails, notifications } = makeFakes({
    members: [{ workspaceId: 'w1', userId: 'u1', role: 'owner' }],
    users: [
      { id: 'u1', email: 'u1@x', displayName: 'Ярослав' },
      { id: 'u2', email: 'u2@x', displayName: 'Гость' },
    ],
  });
  await create.execute({ workspaceId: 'w1', actorUserId: 'u1', role: 'viewer', email: 'u2@x' });
  await delivery.run();
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

test('list: expired invitations remain visible until accepted or revoked', async () => {
  const { list } = makeFakes({
    members: [{ workspaceId: 'w1', userId: 'u1', role: 'owner' }],
    invites: [
      pendingInvite(),
      pendingInvite({ id: 'inv-2', token: 'u'.repeat(64), acceptedAt: NOW }),
      pendingInvite({ id: 'inv-3', token: 'v'.repeat(64), expiresAt: new Date(NOW.getTime() - 1) }),
    ],
  });
  const items = await list.execute('w1', 'u1');
  assert.deepEqual(items.map((i) => i.id), ['inv-1', 'inv-3']);
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

test('delete: editor may revoke their own invitation', async () => {
  const { del, invitesRepo } = makeFakes({
    members: [{ workspaceId: 'w1', userId: 'u2', role: 'editor' }],
    invites: [pendingInvite({ createdByUserId: 'u2' })],
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


test('create reuses normalized email without changing role/access or sending twice', async () => {
  const f = makeFakes({ members: [{ workspaceId: 'w1', userId: 'u1', role: 'owner' }] });
  const first = await f.create.execute({ workspaceId: 'w1', actorUserId: 'u1', email: 'Person@Example.Test', role: 'editor', excludedProjectIds: ['p2'] });
  const second = await f.create.execute({ workspaceId: 'w1', actorUserId: 'u1', email: ' person@example.test ', role: 'viewer' });
  assert.equal(second.reused, true); assert.equal(second.invite.id, first.invite.id);
  assert.equal(second.invite.role, 'editor'); assert.deepEqual(second.invite.excludedProjectIds, ['p2']);
  await f.delivery.run(); assert.equal(f.sentEmails.length, 1);
});

test('create does not invite an existing member', async () => {
  const f = makeFakes({ members: [{ workspaceId: 'w1', userId: 'u1', role: 'owner' }, { workspaceId: 'w1', userId: 'u2', role: 'editor' }], users: [{ id: 'u2', email: 'member@example.test', displayName: 'Member' }] });
  await assert.rejects(f.create.execute({ workspaceId: 'w1', actorUserId: 'u1', email: 'member@example.test', role: 'editor' }), WorkspaceInviteMemberExistsError);
});

test('resend renews expired invite without changing token/access; rate limited and tenant guarded', async () => {
  const f = makeFakes({ members: [{ workspaceId: 'w1', userId: 'u1', role: 'owner' }, { workspaceId: 'w2', userId: 'u1', role: 'owner' }], invites: [pendingInvite({ expiresAt: new Date(NOW.getTime() - 1), excludedProjectIds: ['p2'], email: 'a@example.test' })] });
  await assert.rejects(f.manage.link('w1', 'u1', 'inv-1'), WorkspaceInviteExpiredError);
  const updated = await f.manage.resend('w1', 'u1', 'inv-1');
  assert.equal(updated.token, 't'.repeat(64)); assert.deepEqual(updated.excludedProjectIds, ['p2']);
  assert.equal(updated.expiresAt.getTime(), NOW.getTime() + TTL_MS);
  await assert.rejects(f.manage.resend('w1', 'u1', 'inv-1'), WorkspaceInviteCooldownError);
  await assert.rejects(f.manage.link('w2', 'u1', 'inv-1'), WorkspaceInviteNotFoundError);
});

test('editor cannot retrieve, resend or revoke another inviter token', async () => {
  const f = makeFakes({ members: [{ workspaceId: 'w1', userId: 'u2', role: 'editor' }], invites: [pendingInvite({ email: 'person@example.test' })] });
  await assert.rejects(f.manage.link('w1', 'u2', 'inv-1'), NotWorkspaceLeadError);
  await assert.rejects(f.manage.resend('w1', 'u2', 'inv-1'), NotWorkspaceLeadError);
  await assert.rejects(f.del.execute('w1', 'u2', 'inv-1'), NotWorkspaceLeadError);
  const repeated = await f.create.execute({ workspaceId: 'w1', actorUserId: 'u2', email: 'person@example.test', role: 'editor' });
  assert.equal(repeated.reused, true); assert.equal(repeated.canShare, false);
});
