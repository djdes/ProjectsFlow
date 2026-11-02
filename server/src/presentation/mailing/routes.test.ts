import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { mailingAdminRouter, mailingPublicRouter } from './routes.js';
import { ADMIN, INPUT, mailingHarness } from '../../../test/mailingHarness.js';

async function api() {
  const h = mailingHarness(); const app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.headers['x-test-role'];
    if (role) req.user = { ...ADMIN, isAdmin: role === 'admin' } as typeof req.user;
    next();
  });
  app.use('/admin', mailingAdminRouter(h.service)); app.use('/public', mailingPublicRouter(h.service));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { ...h, request: (path: string, method = 'GET', body?: unknown, role?: string) => fetch(base + path, {
    method, headers: { ...(role ? { 'x-test-role': role } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'manual',
  }), close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

test('every management route rejects anonymous and non-admin requests before data access', async () => {
  const a = await api();
  try {
    const routes = [['GET','overview'],['GET','audience'],['GET','contacts'],['POST','contacts'],['DELETE','contacts/x'],
      ['POST','imports/preview'],['POST','imports'],['GET','stoplist'],['POST','stoplist'],['DELETE','stoplist/a'],
      ['PUT','settings'],['POST','reach'],['POST','preview'],['POST','campaigns'],['GET','campaigns/campaign'],
      ['PATCH','campaigns/campaign'],['DELETE','campaigns/campaign'],['POST','campaigns/campaign/launch'],
      ['POST','campaigns/campaign/test'],['POST','campaigns/campaign/cancel'],['POST','campaigns/campaign/retry']];
    for (const role of [undefined, 'member']) for (const [method, path] of routes) {
      const response = await a.request(`/admin/${path}`, method, method === 'GET' ? undefined : {}, role);
      assert.equal(response.status, role ? 403 : 401, `${role ?? 'anonymous'} ${method} ${path}`);
    }
    assert.equal(a.state.calls.length, 0); assert.equal(a.state.sent.length, 0);
  } finally { await a.close(); }
});

test('admin API enforces payloads, versions, valid dates and self-only test recipients', async () => {
  const a = await api();
  try {
    assert.equal((await a.request('/admin/overview', 'GET', undefined, 'admin')).status, 200);
    assert.equal((await a.request('/admin/campaigns/campaign/test', 'POST', { email: 'victim@example.com' }, 'admin')).status, 400);
    assert.equal(a.state.sent.length, 0);
    assert.equal((await a.request('/admin/campaigns/campaign/test', 'POST', {}, 'admin')).status, 200);
    assert.equal(a.state.sent[0]!.email, ADMIN.email);
    for (const query of ['registeredTo=2026-02-30', 'registeredFrom=2026-11-03&registeredTo=2026-11-02', 'page=-1']) {
      assert.equal((await a.request(`/admin/audience?${query}`, 'GET', undefined, 'admin')).status, 400);
    }
    assert.equal((await a.request('/admin/settings', 'PUT', { enabled: true, perMinute: 0, perDay: 20 }, 'admin')).status, 400);
    assert.equal((await a.request('/admin/campaigns/campaign', 'PATCH', { ...INPUT, revision: 9 }, 'admin')).status, 409);
    assert.equal((await a.request('/admin/campaigns/missing', 'GET', undefined, 'admin')).status, 404);
    const created = await a.request('/admin/campaigns', 'POST', INPUT, 'admin'); assert.equal(created.status, 201);
    assert.equal((await created.json()).status, 'draft');
  } finally { await a.close(); }
});

test('public tokens never expose an audience; unsubscribe requires POST and redirects use only the stored URL', async () => {
  const a = await api(); const token = 'a'.repeat(64);
  try {
    const confirmation = await a.request(`/public/unsubscribe/${token}`);
    assert.equal(confirmation.status, 200); assert.match(confirmation.headers.get('content-security-policy')!, /form-action 'self'/);
    assert.doesNotMatch(await confirmation.text(), /alex@example.com/); assert.equal(a.state.blocked.size, 0);
    assert.equal((await a.request('/public/unsubscribe/invalid', 'POST')).status, 404);
    assert.equal((await a.request(`/public/unsubscribe/${'b'.repeat(64)}`, 'POST')).status, 404);
    assert.equal((await a.request(`/public/unsubscribe/${token}`, 'POST')).status, 200);
    assert.equal(a.state.blocked.has('alex@example.com'), true);
    assert.equal((await a.request(`/public/unsubscribe/${token}`, 'POST')).status, 200);
    const click = await a.request(`/public/click/${token}?url=https://attacker.example/`);
    assert.equal(click.status, 303); assert.equal(click.headers.get('location'), INPUT.content.buttonUrl);
    assert.equal(click.headers.get('referrer-policy'), 'no-referrer');
    a.repository.click = async () => 'javascript:alert(1)';
    assert.equal((await a.request(`/public/click/${token}`)).status, 404);
  } finally { await a.close(); }
});
