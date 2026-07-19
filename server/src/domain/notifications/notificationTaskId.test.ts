import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notificationTaskId, type NotificationPayload } from './Notification.js';

test('достаёт taskId у уведомлений про задачу', () => {
  const mention = {
    type: 'comment_mention',
    projectId: 'p1',
    projectName: 'Проект',
    taskId: 't1',
    taskExcerpt: 'Задача',
    commentId: 'c1',
    commentExcerpt: 'текст',
    actorUserId: 'u2',
    actorDisplayName: 'Кто-то',
  } satisfies NotificationPayload;

  assert.equal(notificationTaskId(mention), 't1');
});

test('уведомления без задачи не дают ложного taskId', () => {
  const invite = {
    type: 'workspace_invite',
    workspaceId: 'w1',
    workspaceName: 'Пространство',
    role: 'editor',
    inviteId: 'i1',
    token: 'tok',
    actorUserId: 'u2',
    actorDisplayName: 'Кто-то',
  } satisfies NotificationPayload;

  assert.equal(notificationTaskId(invite), null);
});
