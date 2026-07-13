import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AcceptProjectInvite } from './AcceptProjectInvite.js';
import type { ProjectInvite } from '../../domain/project/ProjectInvite.js';
import type { WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';
import {
  ProjectInviteExpiredError,
  ProjectInviteNotFoundError,
} from '../../domain/project/errors.js';

const NOW = new Date('2026-07-13T12:00:00Z');
const FUTURE = new Date('2026-07-20T12:00:00Z');
const TOKEN = 'p'.repeat(64);

function invite(over: Partial<ProjectInvite> = {}): ProjectInvite {
  return {
    id: 'pi-1', projectId: 'p-1', role: 'editor', token: TOKEN, email: null,
    expiresAt: FUTURE, acceptedAt: null, acceptedByUserId: null,
    createdByUserId: 'u1', createdAt: NOW,
    ...over,
  };
}

function makeFakes(seed: {
  invites?: ProjectInvite[];
  members?: Array<{ workspaceId: string; userId: string; role: WorkspaceRole }>;
}) {
  const invites = new Map<string, ProjectInvite>((seed.invites ?? []).map((i) => [i.id, i]));
  const members = (seed.members ?? []).map((m) => ({ ...m }));

  const uc = new AcceptProjectInvite({
    invites: {
      async findByToken(token) {
        for (const i of invites.values()) if (i.token === token) return i;
        return null;
      },
      async markAccepted({ inviteId, acceptedAt, acceptedByUserId }) {
        const i = invites.get(inviteId);
        if (!i) return null;
        const next = { ...i, acceptedAt, acceptedByUserId };
        invites.set(inviteId, next);
        return next;
      },
    },
    projects: {
      async getWorkspaceId(projectId) {
        return projectId === 'p-1' ? 'ws-1' : null;
      },
    },
    workspaces: {
      async getMembership(workspaceId, userId) {
        const m = members.find((x) => x.workspaceId === workspaceId && x.userId === userId);
        return m ? { workspaceId, userId, role: m.role } : null;
      },
      async addMember(workspaceId, userId, role) {
        members.push({ workspaceId, userId, role });
      },
    },
    now: () => NOW,
  });
  return { uc, invites, members };
}

test('accept легаси-токена: зачисляет в ПРОСТРАНСТВО проекта с ролью инвайта', async () => {
  const { uc, invites, members } = makeFakes({ invites: [invite()] });
  const res = await uc.execute(TOKEN, 'u2');
  assert.equal(res.projectId, 'p-1');
  assert.deepEqual(members, [{ workspaceId: 'ws-1', userId: 'u2', role: 'editor' }]);
  assert.ok(invites.get('pi-1')?.acceptedAt);
});

test('accept: уже участник пространства — роль не трогаем, токен потребляем', async () => {
  const { uc, invites, members } = makeFakes({
    invites: [invite({ role: 'viewer' })],
    members: [{ workspaceId: 'ws-1', userId: 'u2', role: 'owner' }],
  });
  await uc.execute(TOKEN, 'u2');
  assert.equal(members.length, 1);
  assert.equal(members[0]?.role, 'owner');
  assert.ok(invites.get('pi-1')?.acceptedAt);
});

test('accept: неизвестный токен → ProjectInviteNotFoundError', async () => {
  const { uc } = makeFakes({});
  await assert.rejects(() => uc.execute('nope', 'u2'), ProjectInviteNotFoundError);
});

test('accept: просроченный → ProjectInviteExpiredError, участник не добавлен', async () => {
  const { uc, members } = makeFakes({
    invites: [invite({ expiresAt: new Date(NOW.getTime() - 1000) })],
  });
  await assert.rejects(() => uc.execute(TOKEN, 'u2'), ProjectInviteExpiredError);
  assert.equal(members.length, 0);
});
