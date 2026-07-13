import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ResolveProjectJoinRequest } from './ResolveProjectJoinRequest.js';
import type { WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';

// Стиль фейков — как в DelegateExistingTask.test.ts: минимальные объекты + `as never`.

type JoinRequest = {
  id: string;
  projectId: string;
  requesterUserId: string;
  status: 'pending' | 'accepted' | 'declined';
};

function makeHarness(opts: {
  jr?: Partial<JoinRequest>;
  actorRole?: 'owner' | 'editor' | 'viewer' | null;
  wsMembers?: Array<{ workspaceId: string; userId: string; role: WorkspaceRole }>;
}) {
  const jr: JoinRequest = {
    id: 'jr-1',
    projectId: 'p-1',
    requesterUserId: 'u-req',
    status: 'pending',
    ...opts.jr,
  };
  const wsMembers = (opts.wsMembers ?? []).map((m) => ({ ...m }));
  const resolved: Array<{ id: string; status: string }> = [];

  const uc = new ResolveProjectJoinRequest({
    projects: {
      getById: async (id: string) =>
        id === 'p-1' ? { id: 'p-1', isInbox: false, ownerId: 'u-owner' } : null,
      getWorkspaceId: async (id: string) => (id === 'p-1' ? 'ws-1' : null),
    } as never,
    members: {
      // requireProjectAccess: членство актора в проекте (через пространство — Task 4).
      findForProject: async (_projectId: string, userId: string) =>
        userId === 'u-owner' && opts.actorRole !== null
          ? { projectId: 'p-1', userId, role: opts.actorRole ?? 'owner', joinedAt: new Date(0) }
          : null,
    } as never,
    joinRequests: {
      getById: async (id: string) => (id === jr.id ? { ...jr } : null),
      resolve: async (id: string, status: string) => {
        resolved.push({ id, status });
      },
    } as never,
    workspaces: {
      getMembership: async (workspaceId: string, userId: string) => {
        const m = wsMembers.find((x) => x.workspaceId === workspaceId && x.userId === userId);
        return m ? { workspaceId, userId, role: m.role } : null;
      },
      addMember: async (workspaceId: string, userId: string, role: WorkspaceRole) => {
        wsMembers.push({ workspaceId, userId, role });
      },
    },
    now: () => new Date('2026-07-13T12:00:00Z'),
  });

  return { uc, wsMembers, resolved };
}

test('accept: заявитель зачисляется в ПРОСТРАНСТВО проекта с ролью editor', async () => {
  const { uc, wsMembers, resolved } = makeHarness({});
  const res = await uc.execute('jr-1', 'u-owner', true);
  assert.equal(res.status, 'accepted');
  assert.deepEqual(wsMembers, [{ workspaceId: 'ws-1', userId: 'u-req', role: 'editor' }]);
  assert.deepEqual(resolved, [{ id: 'jr-1', status: 'accepted' }]);
});

test('accept: заявитель уже участник пространства — роль не трогаем', async () => {
  const { uc, wsMembers } = makeHarness({
    wsMembers: [{ workspaceId: 'ws-1', userId: 'u-req', role: 'owner' }],
  });
  await uc.execute('jr-1', 'u-owner', true);
  assert.equal(wsMembers.length, 1);
  assert.equal(wsMembers[0]?.role, 'owner');
});

test('decline: участник не добавляется, статус declined', async () => {
  const { uc, wsMembers, resolved } = makeHarness({});
  const res = await uc.execute('jr-1', 'u-owner', false);
  assert.equal(res.status, 'declined');
  assert.equal(wsMembers.length, 0);
  assert.deepEqual(resolved, [{ id: 'jr-1', status: 'declined' }]);
});

test('уже resolved заявка — идемпотентный ответ без побочек', async () => {
  const { uc, wsMembers, resolved } = makeHarness({ jr: { status: 'accepted' } });
  const res = await uc.execute('jr-1', 'u-owner', true);
  assert.equal(res.status, 'accepted');
  assert.equal(wsMembers.length, 0);
  assert.equal(resolved.length, 0);
});

test('не-владелец не может резолвить (requireProjectAccess invite_member)', async () => {
  const { uc } = makeHarness({ actorRole: null });
  await assert.rejects(() => uc.execute('jr-1', 'u-owner', true));
});
