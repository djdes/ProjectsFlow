import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GetInviteByToken } from './GetInviteByToken.js';
import type { ProjectInvite } from '../../domain/project/ProjectInvite.js';
import type { WorkspaceInvite } from '../../domain/workspace/WorkspaceInvite.js';
import { ProjectInviteNotFoundError } from '../../domain/project/errors.js';
import { WorkspaceInviteExpiredError } from '../../domain/workspace/errors.js';

const NOW = new Date('2026-07-13T12:00:00Z');
const FUTURE = new Date('2026-07-20T12:00:00Z');

const WS_TOKEN = 'w'.repeat(64);
const PJ_TOKEN = 'p'.repeat(64);

function wsInvite(over: Partial<WorkspaceInvite> = {}): WorkspaceInvite {
  return {
    id: 'wi-1', workspaceId: 'ws-1', role: 'editor', token: WS_TOKEN, email: 'x@y',
    expiresAt: FUTURE, acceptedAt: null, acceptedByUserId: null,
    createdByUserId: 'u1', createdAt: NOW,
    ...over,
  };
}

function pjInvite(over: Partial<ProjectInvite> = {}): ProjectInvite {
  return {
    id: 'pi-1', projectId: 'p-1', role: 'viewer', token: PJ_TOKEN, email: null,
    expiresAt: FUTURE, acceptedAt: null, acceptedByUserId: null,
    createdByUserId: 'u1', createdAt: NOW,
    ...over,
  };
}

function makeUseCase(seed: { ws?: WorkspaceInvite[]; pj?: ProjectInvite[]; registered?: boolean }) {
  return new GetInviteByToken({
    workspaceInvites: {
      async findByToken(token) {
        return (seed.ws ?? []).find((i) => i.token === token) ?? null;
      },
    },
    invites: {
      async findByToken(token) {
        return (seed.pj ?? []).find((i) => i.token === token) ?? null;
      },
    },
    projects: {
      async getById(id) {
        return id === 'p-1' ? { name: 'Сайт клиента' } : null;
      },
    },
    workspaces: {
      async getById(id) {
        return id === 'ws-1' ? { name: 'Команда X' } : null;
      },
    },
    users: {
      async getByEmail() {
        return seed.registered ? { id: 'recipient' } : null;
      },
      async getById() {
        return { displayName: 'Ярослав' };
      },
    },
    now: () => NOW,
  });
}

test('workspace-токен резолвится первым: kind=workspace, имя пространства', async () => {
  const uc = makeUseCase({ ws: [wsInvite()] });
  const preview = await uc.execute(WS_TOKEN);
  assert.equal(preview.kind, 'workspace');
  assert.equal(preview.targetName, 'Команда X');
  assert.equal(preview.role, 'editor');
  assert.equal(preview.inviterDisplayName, 'Ярослав');
});

test('легаси project-токен: kind=project, имя проекта', async () => {
  const uc = makeUseCase({ pj: [pjInvite()] });
  const preview = await uc.execute(PJ_TOKEN);
  assert.equal(preview.kind, 'project');
  assert.equal(preview.targetName, 'Сайт клиента');
  assert.equal(preview.role, 'viewer');
});

test('неизвестный токен → ProjectInviteNotFoundError (единый 404 invite_not_found)', async () => {
  const uc = makeUseCase({});
  await assert.rejects(() => uc.execute('nope'), ProjectInviteNotFoundError);
});

test('просроченный workspace-токен → WorkspaceInviteExpiredError', async () => {
  const uc = makeUseCase({
    ws: [wsInvite({ expiresAt: new Date(NOW.getTime() - 1000) })],
  });
  await assert.rejects(() => uc.execute(WS_TOKEN), WorkspaceInviteExpiredError);
});

test('email invitation selects registration for a new recipient', async () => {
  const preview = await makeUseCase({ ws: [wsInvite()] }).execute(WS_TOKEN);
  assert.equal(preview.authMode, 'register');
  assert.equal(preview.inviteEmail, 'x@y');
});

test('email invitation selects login for an existing recipient', async () => {
  const preview = await makeUseCase({ ws: [wsInvite()], registered: true }).execute(WS_TOKEN);
  assert.equal(preview.authMode, 'login');
});

test('untargeted legacy invitation defaults to login', async () => {
  const preview = await makeUseCase({ pj: [pjInvite()] }).execute(PJ_TOKEN);
  assert.equal(preview.authMode, 'login');
});
