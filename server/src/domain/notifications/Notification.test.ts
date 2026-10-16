import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isVisibleInWorkspace, type NotificationPayload } from './Notification.js';

const of = (type: string, workspaceId: string | null) => ({
  workspaceId,
  payload: { type } as NotificationPayload,
});

test('приглашение в чужое пространство видно в любом активном — иначе его не найти', () => {
  // 14.10.2026: инвайт хранится с пространством приглашающего, получатель там ещё не участник.
  assert.equal(isVisibleInWorkspace(of('workspace_invite', 'ws-other'), 'ws-mine'), true);
  assert.equal(isVisibleInWorkspace(of('project_invite', 'ws-other'), 'ws-mine'), true);
  assert.equal(isVisibleInWorkspace(of('support_ticket', null), 'ws-mine'), true);
});

test('рабочие уведомления других пространств не протекают', () => {
  assert.equal(isVisibleInWorkspace(of('task_changed', 'ws-other'), 'ws-mine'), false);
  assert.equal(isVisibleInWorkspace(of('join_request', 'ws-other'), 'ws-mine'), false);
  assert.equal(isVisibleInWorkspace(of('task_changed', 'ws-mine'), 'ws-mine'), true);
});
