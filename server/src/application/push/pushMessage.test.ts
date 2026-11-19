import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Notification, NotificationPayload } from '../../domain/notifications/Notification.js';
import { pushMessageFor } from './pushMessage.js';

function notification(payload: NotificationPayload, workspaceId: string | null = 'ws1'): Notification {
  return { id: 'n1', userId: 'u1', workspaceId, payload, readAt: null, createdAt: new Date() };
}

const taskChanged = {
  type: 'task_changed',
  taskId: 't 1',
  projectId: 'p1',
  projectName: 'Сайт',
  taskExcerpt: '## **Починить** [форму](https://example.com)\n<figure data-figure-image><img src="x"></figure>подробности',
  actorUserId: 'u2',
  actorDisplayName: 'Анна',
  action: 'approval_requested',
  title: 'Задача ждёт утверждения',
  detail: 'Статус: В работе → На утверждении\nСрок до: 01.12.2026 → 02.12.2026',
  taskAvailable: true,
} as const satisfies NotificationPayload;

test('task changes deep-link to the task page and read as plain text', () => {
  assert.deepEqual(pushMessageFor(notification({ ...taskChanged, commentId: 'c9' })), {
    title: 'Задача ждёт утверждения',
    body: '«Починить форму»\nСтатус: В работе → На утверждении Срок до: 01.12.2026 → 02.12.2026\nАнна · Сайт',
    url: '/projects/p1/tasks/t%201#comment-c9',
    workspaceId: 'ws1',
  });
});

test('a task the person can no longer open leads to the home screen', () => {
  const message = pushMessageFor(notification({ ...taskChanged, action: 'deleted', taskAvailable: false }, null));
  assert.equal(message.url, '/');
  assert.equal(message.workspaceId, null);
});

test('assignment and approval requests open the task', () => {
  const base = { taskId: 't1', projectId: 'p1', projectName: 'Сайт', taskExcerpt: 'Сверстать', actorUserId: 'u2', actorDisplayName: 'Анна' };
  assert.deepEqual(pushMessageFor(notification({ ...base, type: 'task_assignee_changed', isInbox: true })), {
    title: 'Вам назначена задача', body: '«Сверстать»\nАнна · Сайт', url: '/projects/p1/tasks/t1', workspaceId: 'ws1',
  });
  assert.equal(pushMessageFor(notification({ ...base, type: 'task_approval_requested' })).title, 'Задача ждёт утверждения');
});

test('invitations open the invitation page', () => {
  const message = pushMessageFor(notification({
    type: 'workspace_invite', workspaceId: 'ws2', workspaceName: 'Студия', role: 'editor', inviteId: 'i1',
    token: 'tok/1', actorUserId: 'u2', actorDisplayName: 'Анна',
  }));
  assert.deepEqual(message, {
    title: 'Приглашение в пространство', body: 'Анна приглашает вас в «Студия»', url: '/invite/tok%2F1', workspaceId: 'ws1',
  });
});

test('long texts are shortened for the lock screen', () => {
  const message = pushMessageFor(notification({
    type: 'chat_mention', workspaceId: 'ws1', workspaceName: 'Студия', messageId: 'm1', messageSeq: 1,
    messageExcerpt: 'слово '.repeat(200), actorUserId: 'u2', actorDisplayName: 'Анна',
  }));
  assert.ok(message.body.length <= 360);
  assert.ok(message.body.endsWith('…'));
  assert.equal(message.url, '/');
});
