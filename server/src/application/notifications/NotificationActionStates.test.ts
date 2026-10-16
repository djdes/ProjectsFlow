import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Notification, NotificationPayload } from '../../domain/notifications/Notification.js';
import { NotificationActionStates } from './NotificationActionStates.js';

const NOW = new Date('2026-10-16T10:00:00Z');

function notice(id: string, payload: Record<string, unknown>): Notification {
  return { id, userId: 'owner', payload: payload as NotificationPayload, readAt: null, createdAt: NOW };
}

function make(opts: {
  open?: Notification[];
  requests?: Record<string, { status: 'pending' | 'accepted' | 'declined'; projectId: string; requesterUserId: string }>;
  invites?: Record<string, { acceptedAt: Date | null; expiresAt: Date }>;
  access?: string[];
}) {
  const marked: string[] = [];
  const states = new NotificationActionStates({
    repo: {
      listByUser: async () => opts.open ?? [],
      markRead: async (id) => { marked.push(id); return true; },
    },
    joinRequests: { getById: async (id) => opts.requests?.[id] ?? null },
    projectInvites: { getById: async (id) => opts.invites?.[id] ?? null },
    workspaceInvites: { getById: async (id) => opts.invites?.[id] ?? null },
    hasProjectAccess: async (projectId, userId) => (opts.access ?? []).includes(`${projectId}:${userId}`),
    isWorkspaceMember: async (workspaceId, userId) => (opts.access ?? []).includes(`${workspaceId}:${userId}`),
    now: () => NOW,
  });
  return { states, marked };
}

test('запрос доступа к удалённому проекту — «неактуально», кнопки не будет', async () => {
  // 16.10.2026: «Принять» на запросе Дениса к удалённому Magday Manager отвечало not_found.
  const { states } = make({});
  assert.equal(await states.stateOf(notice('n1', { type: 'join_request', joinRequestId: 'gone' })), 'expired');
});

test('доступ уже выдан — запрос и приглашение считаются принятыми', async () => {
  const { states } = make({
    requests: { jr: { status: 'pending', projectId: 'p1', requesterUserId: 'denis' } },
    invites: { inv: { acceptedAt: null, expiresAt: new Date('2026-11-01') } },
    access: ['p1:denis', 'ws1:owner'],
  });
  assert.equal(await states.stateOf(notice('n1', { type: 'join_request', joinRequestId: 'jr' })), 'accepted');
  assert.equal(
    await states.stateOf(notice('n2', { type: 'workspace_invite', inviteId: 'inv', workspaceId: 'ws1' })),
    'accepted',
  );
});

test('уборка гасит только то, на что отвечать уже не нужно', async () => {
  const open = [
    notice('stale', { type: 'join_request', joinRequestId: 'resolved' }),
    notice('live', { type: 'project_invite', inviteId: 'inv', projectId: 'p2' }),
    notice('expired', { type: 'project_invite', inviteId: 'old', projectId: 'p2' }),
  ];
  const { states, marked } = make({
    open,
    requests: { resolved: { status: 'declined', projectId: 'p1', requesterUserId: 'denis' } },
    invites: {
      inv: { acceptedAt: null, expiresAt: new Date('2026-11-01') },
      old: { acceptedAt: null, expiresAt: new Date('2026-10-01') },
    },
  });
  await states.reconcile('owner', 'ws1');
  assert.deepEqual(marked, ['stale', 'expired']);
  const listed = await states.attach(open);
  assert.deepEqual(listed.map((n) => n.actionState), ['declined', 'pending', 'expired']);
});
