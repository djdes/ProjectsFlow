import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PushEndpointNotSupportedError } from '../../domain/push/errors.js';
import { MAX_PUSH_SUBSCRIPTIONS_PER_USER, ManagePushSubscriptions } from './ManagePushSubscriptions.js';
import { InMemoryPushSubscriptions } from './FakePush.test-helper.js';

function setup() {
  const repo = new InMemoryPushSubscriptions();
  const manage = new ManagePushSubscriptions({
    repo,
    vapid: { get: async () => ({ publicKey: 'server-public-key', privateKey: 'secret' }) },
  });
  return { repo, manage };
}

const keys = { p256dh: 'p', auth: 'a' };

test('exposes only the public key', async () => {
  const { manage } = setup();
  assert.equal(await manage.publicKey(), 'server-public-key');
});

test('subscribing the same device again updates it and moves it to the current account', async () => {
  const { repo, manage } = setup();
  const endpoint = 'https://web.push.apple.com/device';
  await manage.subscribe({ userId: 'u1', endpoint, keys, userAgent: 'Safari' });
  await manage.subscribe({ userId: 'u2', endpoint, keys: { p256dh: 'p2', auth: 'a2' }, userAgent: 'Safari' });

  assert.equal(repo.rows.length, 1);
  assert.equal(repo.rows[0]!.userId, 'u2');
  assert.deepEqual(repo.rows[0]!.keys, { p256dh: 'p2', auth: 'a2' });
});

test('endpoints outside known push services are rejected', async () => {
  const { repo, manage } = setup();
  for (const endpoint of ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://intranet.local/push', 'https://evilgoogleapis.com/x']) {
    await assert.rejects(manage.subscribe({ userId: 'u1', endpoint, keys, userAgent: null }), PushEndpointNotSupportedError);
  }
  assert.equal(repo.rows.length, 0);
});

test('a person keeps a bounded number of devices', async () => {
  const { repo, manage } = setup();
  for (let i = 0; i < MAX_PUSH_SUBSCRIPTIONS_PER_USER + 3; i += 1) {
    await manage.subscribe({ userId: 'u1', endpoint: `https://fcm.googleapis.com/fcm/send/${i}`, keys, userAgent: null });
  }
  assert.equal(repo.rows.length, MAX_PUSH_SUBSCRIPTIONS_PER_USER);
  assert.ok(repo.rows.some((row) => row.endpoint.endsWith(`/${MAX_PUSH_SUBSCRIPTIONS_PER_USER + 2}`)));
  assert.ok(!repo.rows.some((row) => row.endpoint.endsWith('/0')));
});

test('unsubscribe removes only the current person\'s device', async () => {
  const { repo, manage } = setup();
  await manage.subscribe({ userId: 'u1', endpoint: 'https://web.push.apple.com/a', keys, userAgent: null });
  await manage.unsubscribe('u2', 'https://web.push.apple.com/a');
  assert.equal(repo.rows.length, 1);
  await manage.unsubscribe('u1', 'https://web.push.apple.com/a');
  assert.equal(repo.rows.length, 0);
});
