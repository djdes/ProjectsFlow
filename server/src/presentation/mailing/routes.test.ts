import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { adminMailingRouter, mailingUnsubscribeRouter } from './routes.js';
import type { MailingService } from '../../application/mailing/MailingService.js';
import { MailingError } from '../../domain/mailing/errors.js';

async function harness() {
  const calls: string[] = [];
  const service = {
    listTemplates: async () => [],
    starters: () => [],
    reach: async () => { throw new MailingError('audience_changed', 'Аудитория изменилась'); },
    previewUnsubscribe: async (token: string) => {
      calls.push(`preview:${token}`);
      return token === 'good.sig' ? { kind: 'ok', maskedEmail: 'an***@example.test', alreadyUnsubscribed: false } : { kind: 'invalid' };
    },
    unsubscribe: async (token: string) => {
      calls.push(`unsubscribe:${token}`);
      return token === 'good.sig' ? { kind: 'done', maskedEmail: 'an***@example.test' } : { kind: 'invalid' };
    },
  } as unknown as MailingService;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.headers['x-test-role'];
    if (role) req.user = { id: 'u1', isAdmin: role === 'admin', email: 'u1@example.test', displayName: 'Админ', avatarUrl: null, createdAt: new Date() };
    next();
  });
  app.use('/api/mailing/unsubscribe', mailingUnsubscribeRouter({ service }));
  app.use('/api/admin/mailings', adminMailingRouter({ service }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, calls, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

test('mailing admin API is admin-only and maps domain errors', async () => {
  const h = await harness();
  try {
    assert.equal((await fetch(`${h.base}/api/admin/mailings/templates`)).status, 401);
    assert.equal((await fetch(`${h.base}/api/admin/mailings/templates`, { headers: { 'x-test-role': 'user' } })).status, 403);
    assert.equal((await fetch(`${h.base}/api/admin/mailings/templates`, { headers: { 'x-test-role': 'admin' } })).status, 200);
    const bad = await fetch(`${h.base}/api/admin/mailings/reach`, {
      method: 'POST', headers: { 'x-test-role': 'admin', 'content-type': 'application/json' }, body: JSON.stringify({ audience: { kind: 'nobody' } }),
    });
    assert.equal(bad.status, 400);
    const changed = await fetch(`${h.base}/api/admin/mailings/reach`, {
      method: 'POST', headers: { 'x-test-role': 'admin', 'content-type': 'application/json' }, body: JSON.stringify({ audience: { kind: 'all' } }),
    });
    assert.equal(changed.status, 409);
    assert.deepEqual(await changed.json(), { error: 'audience_changed', message: 'Аудитория изменилась' });
  } finally { await h.close(); }
});

test('unsubscribe: GET only confirms, POST button and RFC 8058 one-click unsubscribe', async () => {
  const h = await harness();
  try {
    const page = await fetch(`${h.base}/api/mailing/unsubscribe/good.sig`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<form method="post"/);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.deepEqual(h.calls, ['preview:good.sig'], 'GET must not unsubscribe');

    const noConfirm = await fetch(`${h.base}/api/mailing/unsubscribe/good.sig`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: '' });
    assert.equal(noConfirm.status, 400);

    const button = await fetch(`${h.base}/api/mailing/unsubscribe/good.sig`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=unsubscribe' });
    assert.match(await button.text(), /Вы отписались/);
    const oneClick = await fetch(`${h.base}/api/mailing/unsubscribe/good.sig`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' });
    assert.deepEqual(await oneClick.json(), { ok: true });
    assert.equal(h.calls.filter((c) => c === 'unsubscribe:good.sig').length, 2);

    assert.equal((await fetch(`${h.base}/api/mailing/unsubscribe/forged.x`)).status, 404);
  } finally { await h.close(); }
});
