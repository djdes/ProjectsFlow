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

test('рабочие уведомления других пространств и осиротевшие не протекают', () => {
  // 16.10.2026: запрос доступа к удалённому проекту остался без пространства и всплыл
  // в колокольчике с кнопкой «Принять», которая отвечала not_found.
  assert.equal(isVisibleInWorkspace(of('join_request', null), 'ws-mine'), false);
  assert.equal(isVisibleInWorkspace(of('task_changed', 'ws-other'), 'ws-mine'), false);
  assert.equal(isVisibleInWorkspace(of('join_request', 'ws-other'), 'ws-mine'), false);
  assert.equal(isVisibleInWorkspace(of('task_changed', 'ws-mine'), 'ws-mine'), true);
});
