import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { meTelegramRouter } from './telegramRoutes.js';
import { PairTelegramAccount } from '../../application/telegram/PairTelegramAccount.js';
import { InMemoryRateLimiter } from '../../infrastructure/ratelimit/InMemoryRateLimiter.js';

test('Telegram pairing API: auth, session owner, cache, limits, conflicts and revocation', async () => {
  const calls: string[] = [];
  let authenticated = true, enabled = true, available = true;
  const pairing = new PairTelegramAccount({
    enabled: true, botUsername: 'Test_Bot', repository: {
      issue: async ({ userId }) => { calls.push(`issue:${userId}`); return available; },
      complete: async () => { throw new Error('HTTP cannot redeem a Telegram connection'); },
      revoke: async (id) => { calls.push(`revoke:${id}`); },
    },
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { if (authenticated) req.user = { id: 'session-owner' } as never; next(); });
  app.use('/api/me/telegram', meTelegramRouter({
    pairing, rateLimiter: new InMemoryRateLimiter(), connect: {} as never,
    users: { clearTelegramLink: async (id: string) => { calls.push(`clear:${id}`); } } as never,
    status: { execute: async () => ({ connected: enabled }) } as never,
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/me/telegram`;
  const start = () => fetch(`${base}/connect/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 'victim', telegramUserId: 999 }) });
  try {
    authenticated = false;
    assert.equal((await start()).status, 401);
    assert.equal(calls.length, 0);
    authenticated = true;
    let res = await start();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match((await res.json()).url, /^https:\/\/t.me\/Test_Bot\?start=connect_/);
    assert.deepEqual(calls, ['issue:session-owner']);
    available = false;
    assert.equal((await start()).status, 409);
    available = true;
    for (let i = 0; i < 8; i++) assert.equal((await start()).status, 200);
    res = await start();
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('retry-after'), '60');
    assert.equal((await fetch(base, { method: 'DELETE' })).status, 204);
    assert.deepEqual(calls.slice(-2), ['revoke:session-owner', 'clear:session-owner']);
    enabled = false;
    assert.equal((await (await fetch(base)).json()).connected, false);
    assert.equal((await fetch(`${base}/connect/complete`, { method: 'POST' })).status, 404);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
