import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Notification } from '../../domain/notifications/Notification.js';
import { PushNotificationDispatcher } from './PushNotificationDispatcher.js';
import { FakePushSender, InMemoryPushSubscriptions, subscription } from './FakePush.test-helper.js';

const KEYS = { publicKey: 'public-key', privateKey: 'private-key' };

function mention(userId = 'u1'): Notification {
  return {
    id: 'n1',
    userId,
    workspaceId: 'ws1',
    readAt: null,
    createdAt: new Date('2026-11-17T10:00:00Z'),
    payload: {
      type: 'comment_mention',
      projectId: 'p1',
      projectName: 'Сайт',
      taskId: 't1',
      taskExcerpt: 'Сверстать шапку\nподробности',
      commentId: 'c1',
      commentExcerpt: 'посмотри, пожалуйста',
      actorUserId: 'u2',
      actorDisplayName: 'Анна',
    },
  };
}

function setup(options: {
  readonly respond?: ConstructorParameters<typeof FakePushSender>[0];
  readonly canReceive?: (userId: string, notification: Notification) => Promise<boolean>;
  readonly vapidFails?: boolean;
} = {}) {
  const subscriptions = new InMemoryPushSubscriptions();
  const sender = new FakePushSender(options.respond);
  const logs: string[] = [];
  const dispatcher = new PushNotificationDispatcher({
    subscriptions,
    sender,
    vapid: { get: async () => {
      if (options.vapidFails) throw new Error('db down');
      return KEYS;
    } },
    subject: 'https://projectsflow.ru',
    ...(options.canReceive ? { canReceive: options.canReceive } : {}),
    now: () => new Date('2026-11-17T10:00:01Z'),
    log: (message) => { logs.push(message); },
  });
  return { subscriptions, sender, dispatcher, logs };
}

test('sends the notification to every device of the recipient with a deep link to the task', async () => {
  const { subscriptions, sender, dispatcher } = setup();
  await subscriptions.upsert(subscription('u1', 'https://fcm.googleapis.com/fcm/send/phone'));
  await subscriptions.upsert(subscription('u1', 'https://web.push.apple.com/iphone'));
  await subscriptions.upsert(subscription('u2', 'https://web.push.apple.com/someone-else'));

  const summary = await dispatcher.dispatch(mention());

  assert.deepEqual(summary, { sent: 2, gone: 0, failed: 0 });
  assert.deepEqual(sender.sent.map((push) => push.endpoint).sort(), [
    'https://fcm.googleapis.com/fcm/send/phone',
    'https://web.push.apple.com/iphone',
  ]);
  assert.deepEqual(sender.sent[0]!.payload, {
    title: 'Вас упомянули в комментарии',
    body: 'Анна: посмотри, пожалуйста\n«Сверстать шапку» · Сайт',
    url: '/projects/p1/tasks/t1#comment-c1',
    workspaceId: 'ws1',
  });
  assert.deepEqual(sender.sent[0]!.vapid, { ...KEYS, subject: 'https://projectsflow.ru' });
  assert.ok(subscriptions.rows.filter((row) => row.userId === 'u1').every((row) => row.lastSuccessAt !== null));
});

test('publish returns at once and swallows delivery failures', async () => {
  const { subscriptions, sender, dispatcher, logs } = setup({
    respond: () => { throw new Error('socket hang up'); },
  });
  await subscriptions.upsert(subscription('u1', 'https://fcm.googleapis.com/fcm/send/phone'));

  assert.doesNotThrow(() => dispatcher.publish(mention()));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sender.sent.length, 1);
  assert.equal(subscriptions.rows.length, 1, 'a transient failure keeps the subscription');
  assert.ok(logs.some((line) => line.includes('socket hang up')));
});

test('publish never rejects even when the keys or the database fail', async () => {
  const { subscriptions, sender, dispatcher, logs } = setup({ vapidFails: true });
  await subscriptions.upsert(subscription('u1', 'https://fcm.googleapis.com/fcm/send/phone'));
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
  process.on('unhandledRejection', onUnhandled);
  try {
    dispatcher.publish(mention());
    await new Promise((resolve) => setTimeout(resolve, 10));
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert.equal(sender.sent.length, 0);
  assert.deepEqual(unhandled, []);
  assert.ok(logs.includes('[push] dispatch failed'));
});

test('subscriptions the push service no longer knows (404/410) are pruned', async () => {
  const { subscriptions, dispatcher } = setup({
    respond: (endpoint) => endpoint.endsWith('/gone') ? { status: 'gone', statusCode: 410 }
      : endpoint.endsWith('/missing') ? { status: 'gone', statusCode: 404 }
      : endpoint.endsWith('/flaky') ? { status: 'failed', statusCode: 503, message: 'unavailable' }
      : { status: 'sent' },
  });
  await subscriptions.upsert(subscription('u1', 'https://fcm.googleapis.com/fcm/send/gone'));
  await subscriptions.upsert(subscription('u1', 'https://web.push.apple.com/missing'));
  await subscriptions.upsert(subscription('u1', 'https://web.push.apple.com/flaky'));
  await subscriptions.upsert(subscription('u1', 'https://web.push.apple.com/ok'));

  const summary = await dispatcher.dispatch(mention());

  assert.deepEqual(summary, { sent: 1, gone: 2, failed: 1 });
  assert.deepEqual(subscriptions.rows.map((row) => row.endpoint).sort(), [
    'https://web.push.apple.com/flaky',
    'https://web.push.apple.com/ok',
  ]);
});

test('nothing is sent to a recipient who may no longer receive the notification', async () => {
  const { subscriptions, sender, dispatcher } = setup({ canReceive: async () => false });
  await subscriptions.upsert(subscription('u1', 'https://web.push.apple.com/iphone'));

  assert.deepEqual(await dispatcher.dispatch(mention()), { sent: 0, gone: 0, failed: 0 });
  assert.equal(sender.sent.length, 0);
});

test('a recipient without devices costs no key lookup', async () => {
  const { sender, dispatcher } = setup({ vapidFails: true });
  assert.deepEqual(await dispatcher.dispatch(mention()), { sent: 0, gone: 0, failed: 0 });
  assert.equal(sender.sent.length, 0);
});

test('a test push goes only to the device that asked for it', async () => {
  const { subscriptions, sender, dispatcher } = setup();
  await subscriptions.upsert(subscription('u1', 'https://web.push.apple.com/iphone'));
  await subscriptions.upsert(subscription('u1', 'https://fcm.googleapis.com/fcm/send/laptop'));
  await subscriptions.upsert(subscription('u2', 'https://web.push.apple.com/foreign'));

  assert.deepEqual(await dispatcher.sendTest('u1', 'https://web.push.apple.com/iphone'), { sent: 1, gone: 0, failed: 0 });
  assert.deepEqual(sender.sent.map((push) => push.endpoint), ['https://web.push.apple.com/iphone']);
  assert.equal((sender.sent[0]!.payload as { url: string }).url, '/profile');

  assert.deepEqual(await dispatcher.sendTest('u1', 'https://web.push.apple.com/foreign'), { sent: 0, gone: 0, failed: 0 });
  assert.equal(sender.sent.length, 1);
});
