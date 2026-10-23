import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NotificationAlerts } from './NotificationAlerts.js';
import type { Notification } from '../../domain/notifications/Notification.js';

function notice(id: string, workspaceId: string | null, userId = 'me'): Notification {
  return { id, userId, workspaceId, createdAt: new Date('2026-10-23T12:25:06Z'), readAt: null,
    payload: { type: 'task_changed', title: 'Новый комментарий', taskId: 'task' } as never };
}

test('account alerts require the actual recipient and current membership, except personal invitations', async () => {
  const alerts = new NotificationAlerts({
    repo: { listByUser: async () => [] },
    workspaces: { getMembership: async (workspaceId, userId) => workspaceId === 'other-accessible' && userId === 'me' ? {} as never : null },
  });
  assert.equal(await alerts.canReceive('me', notice('comment', 'other-accessible')), true);
  assert.equal(await alerts.canReceive('me', notice('former-member', 'revoked')), false);
  assert.equal(await alerts.canReceive('me', notice('other-recipient', 'other-accessible', 'someone-else')), false);
  assert.equal(await alerts.canReceive('me', notice('orphan', null)), false);
  const invite = { ...notice('invite', 'revoked'), payload: { type: 'workspace_invite' } as never };
  assert.equal(await alerts.canReceive('me', invite), true);
  assert.equal(await alerts.canReceive('someone-else', invite), false);
});

test('reconnect includes recent comments from accessible workspaces, excluding revoked and unrelated records', async () => {
  const rows = [notice('accessible', 'b'), notice('revoked', 'private'), notice('not-mine', 'b', 'other'),
    { ...notice('old', 'b'), createdAt: new Date('2026-10-22T12:25:06Z') }];
  const alerts = new NotificationAlerts({
    repo: { listByUser: async (userId, options) => {
      assert.equal(userId, 'me');
      assert.equal(options.workspaceId, undefined);
      assert.equal(options.unreadOnly, true);
      assert.equal(options.limit, 200);
      return rows;
    } },
    workspaces: { getMembership: async (workspaceId) => workspaceId === 'b' ? {} as never : null },
  });
  assert.deepEqual((await alerts.listSince('me', new Date('2026-10-23T12:00:00Z'))).map(n => n.id), ['accessible']);
});
