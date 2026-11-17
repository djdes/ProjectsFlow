import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { ManagePushSubscriptions } from '../../application/push/ManagePushSubscriptions.js';
import { PushNotificationDispatcher } from '../../application/push/PushNotificationDispatcher.js';
import { FakePushSender, InMemoryPushSubscriptions } from '../../application/push/FakePush.test-helper.js';
import { pushRouter } from './routes.js';

async function start(t: { after(fn: () => void): void }) {
  const repo = new InMemoryPushSubscriptions();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const session = req.get('test-session');
    if (session) req.user = { id: session } as never;
    if (req.get('test-impersonated')) req.impersonatedBy = { id: 'admin', displayName: 'Админ' };
    next();
  });
  const vapid = { get: async () => ({ publicKey: 'server-public', privateKey: 'never-exposed' }) };
  const sender = new FakePushSender();
  app.use('/api/push', pushRouter({
    manage: new ManagePushSubscriptions({ repo, vapid }),
    tester: new PushNotificationDispatcher({ subscriptions: repo, sender, vapid, subject: 'https://projectsflow.ru' }),
  }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/push`;
  return { repo, base, sender };
}

const json = (user: string, extra: Record<string, string> = {}) => ({
  'content-type': 'application/json', 'test-session': user, 'user-agent': 'iPhone Safari', ...extra,
});
const body = (endpoint: string) => JSON.stringify({ endpoint, keys: { p256dh: 'BPx-abc_def', auth: 'aGVsbG8' }, expirationTime: null });

test('push endpoints need a session', async (t) => {
  const { base } = await start(t);
  assert.equal((await fetch(`${base}/public-key`)).status, 401);
  assert.equal((await fetch(`${base}/subscriptions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body('https://web.push.apple.com/x') })).status, 401);
});

test('the public key is served without caching and without the private half', async (t) => {
  const { base } = await start(t);
  const response = await fetch(`${base}/public-key`, { headers: { 'test-session': 'u1' } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  assert.deepEqual(await response.json(), { publicKey: 'server-public' });
});

test('a device subscribes, is stored for the current user and unsubscribes by endpoint', async (t) => {
  const { base, repo } = await start(t);
  const endpoint = 'https://web.push.apple.com/device-1';
  const created = await fetch(`${base}/subscriptions`, { method: 'POST', headers: json('u1'), body: body(endpoint) });
  assert.equal(created.status, 204);
  assert.deepEqual(repo.rows.map(({ userId, endpoint: e, keys, userAgent }) => ({ userId, endpoint: e, keys, userAgent })), [
    { userId: 'u1', endpoint, keys: { p256dh: 'BPx-abc_def', auth: 'aGVsbG8' }, userAgent: 'iPhone Safari' },
  ]);

  const removed = await fetch(`${base}/subscriptions`, { method: 'DELETE', headers: json('u1'), body: JSON.stringify({ endpoint }) });
  assert.equal(removed.status, 204);
  assert.equal(repo.rows.length, 0);
});

test('a test push reaches the subscribed device and 404s for an unknown one', async (t) => {
  const { base, sender } = await start(t);
  const endpoint = 'https://web.push.apple.com/device-3';
  await fetch(`${base}/subscriptions`, { method: 'POST', headers: json('u1'), body: body(endpoint) });

  const sent = await fetch(`${base}/test`, { method: 'POST', headers: json('u1'), body: JSON.stringify({ endpoint }) });
  assert.equal(sent.status, 204);
  assert.deepEqual(sender.sent.map((push) => push.endpoint), [endpoint]);

  const foreign = await fetch(`${base}/test`, { method: 'POST', headers: json('u2'), body: JSON.stringify({ endpoint }) });
  assert.equal(foreign.status, 404);
  assert.equal(sender.sent.length, 1);
});

test('unknown push services and impersonated sessions are refused', async (t) => {
  const { base, repo } = await start(t);
  const foreign = await fetch(`${base}/subscriptions`, { method: 'POST', headers: json('u1'), body: body('https://intranet.example/push') });
  assert.equal(foreign.status, 400);
  assert.equal(((await foreign.json()) as { error: string }).error, 'push_service_not_supported');

  const impersonated = await fetch(`${base}/subscriptions`, {
    method: 'POST', headers: json('u1', { 'test-impersonated': '1' }), body: body('https://web.push.apple.com/device-2'),
  });
  assert.equal(impersonated.status, 403);
  assert.equal(repo.rows.length, 0);
});
