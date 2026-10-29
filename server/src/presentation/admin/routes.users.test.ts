import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { adminRouter } from './routes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { UpdateUserAsAdmin } from '../../application/admin/UpdateUserAsAdmin.js';
import { DeleteUserAsAdmin } from '../../application/admin/DeleteUserAsAdmin.js';
import { SetUserPlanAsAdmin } from '../../application/admin/SetUserPlanAsAdmin.js';
import type { AdminRepository, AdminUpdateUserPatch } from '../../application/admin/AdminRepository.js';
import type { UserRepository } from '../../application/user/UserRepository.js';
import type { PlanId } from '../../domain/usage/Plan.js';
import { effectivePlan, type Subscription } from '../../domain/usage/Subscription.js';
import { AdminUserError } from '../../domain/user/adminErrors.js';

const now = new Date('2026-10-29T12:00:00Z');
async function harness() {
  const profiles = new Map(['admin', 'target', 'other'].map((id) => [id, { id, displayName: id, email: `${id}@example.test`, isAdmin: id === 'admin' }]));
  const subscriptions = new Map<string, Subscription>([['target', { plan: 'prime', startedAt: new Date('2026-10-01T00:00:00Z'), expiresAt: new Date('2026-11-01T00:00:00Z') }]]);
  const changes: string[] = [];
  const repo = {
    updateUser: async (id: string, patch: AdminUpdateUserPatch, actor: string) => {
      const user = profiles.get(id);
      if (!user) throw new AdminUserError('user_not_found', 'Пользователь не найден');
      if ([...profiles.values()].some((p) => p.id !== id && p.email === patch.email)) throw new AdminUserError('email_taken', 'Эта почта уже используется');
      Object.assign(user, patch); changes.push(`update:${id}:${actor}`);
    },
    deleteUser: async (id: string, actor: string) => {
      if (!profiles.delete(id)) throw new AdminUserError('user_not_found', 'Пользователь не найден');
      changes.push(`delete:${id}:${actor}`);
    },
  } as unknown as AdminRepository;
  const users = {
    getSubscription: async (id: string) => subscriptions.get(id) ?? null,
    setPlan: async (id: string, plan: PlanId, startedAt: Date | null, expiresAt: Date | null) => {
      subscriptions.set(id, { plan, startedAt, expiresAt }); changes.push(`plan:${id}`);
    },
  } as unknown as UserRepository;
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.headers['x-test-role'];
    if (role) req.user = { id: 'admin', isAdmin: role === 'admin', email: 'admin@example.test', displayName: 'Админ', avatarUrl: null, createdAt: now };
    next();
  });
  app.use('/admin', adminRouter({ updateUser: new UpdateUserAsAdmin(repo), deleteUser: new DeleteUserAsAdmin(repo),
    setUserPlanAsAdmin: new SetUserPlanAsAdmin({ users, now: () => now }) } as never));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/admin`;
  return { profiles, subscriptions, changes,
    request: (path: string, method: string, body?: unknown, role = 'admin') => fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    close: () => new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve())),
  };
}

test('all user mutations require admin access and cannot be authorized by body fields', async () => {
  const h = await harness();
  try {
    for (const [path, method, body] of [
      ['/users/target', 'PATCH', { displayName: 'Новое имя', isAdmin: true }],
      ['/users/target', 'DELETE', undefined],
      ['/users/target/plan', 'PATCH', { plan: 'vip' }],
    ] as const) {
      assert.equal((await h.request(path, method, body, '')).status, 401);
      assert.equal((await h.request(path, method, body, 'member')).status, 403);
    }
    assert.deepEqual(h.changes, []);
  } finally { await h.close(); }
});

test('profile changes normalize email/name, reject invalid data and conflicts, and report missing users', async () => {
  const h = await harness();
  try {
    for (const patch of [{}, { displayName: '  ' }, { displayName: 'x'.repeat(81) }, { email: 'broken' }, { isAdmin: 'true' }, { passwordHash: 'x' }, { avatarUrl: 'https://example.test/a' }]) {
      assert.equal((await h.request('/users/target', 'PATCH', patch)).status, 400);
    }
    assert.equal(h.changes.length, 0);
    assert.equal((await h.request('/users/target', 'PATCH', { displayName: '  Иван  ', email: ' NEW@Example.Test ', avatarUrl: null })).status, 204);
    assert.equal(h.profiles.get('target')!.email, 'new@example.test');
    assert.equal(h.profiles.get('target')!.displayName, 'Иван');
    assert.deepEqual(h.changes, ['update:target:admin']);
    assert.equal((await h.request('/users/target', 'PATCH', { email: 'other@example.test' })).status, 409);
    assert.equal((await h.request('/users/missing', 'PATCH', { displayName: 'Имя' })).status, 404);
    assert.equal((await h.request('/users/admin', 'PATCH', { isAdmin: false })).status, 409);
    assert.equal(h.profiles.get('admin')!.isAdmin, true);
  } finally { await h.close(); }
});

test('deletion rejects self-deletion and removes only the selected account', async () => {
  const h = await harness();
  try {
    assert.equal((await h.request('/users/admin', 'DELETE')).status, 409);
    assert.equal((await h.request('/users/missing', 'DELETE')).status, 404);
    assert.equal((await h.request('/users/target', 'DELETE')).status, 204);
    assert.equal(h.profiles.has('target'), false);
    assert.equal(h.profiles.has('other'), true);
    assert.deepEqual(h.changes, ['delete:target:admin']);
    assert.equal((await h.request('/users/target', 'DELETE')).status, 404);
  } finally { await h.close(); }
});

test('custom expiry preserves subscription start and supports extending the same plan, unlimited and free', async () => {
  const h = await harness();
  try {
    const start = h.subscriptions.get('target')!.startedAt;
    const patch = (body: unknown) => h.request('/users/target/plan', 'PATCH', body);
    assert.equal((await patch({ plan: 'prime', subscriptionExpiresAt: '2026-12-31T23:59:00+03:00' })).status, 204);
    assert.equal(h.subscriptions.get('target')!.expiresAt!.toISOString(), '2026-12-31T20:59:00.000Z');
    assert.equal(h.subscriptions.get('target')!.startedAt, start);
    assert.equal((await patch({ plan: 'prime', subscriptionExpiresAt: null })).status, 204);
    assert.equal(effectivePlan(h.subscriptions.get('target')!, now), 'prime');
    assert.equal(h.subscriptions.get('target')!.expiresAt, null);
    assert.equal((await patch({ plan: 'vip', subscriptionExpiresAt: '2026-10-28T00:00:00Z' })).status, 204);
    assert.equal(effectivePlan(h.subscriptions.get('target')!, now), 'free');
    assert.equal((await patch({ plan: 'vip' })).status, 204);
    assert.equal(h.subscriptions.get('target')!.expiresAt!.getTime(), now.getTime() + 30 * 86400000);
    assert.equal((await patch({ plan: 'free', subscriptionExpiresAt: null })).status, 204);
    assert.deepEqual(h.subscriptions.get('target'), { plan: 'free', startedAt: null, expiresAt: null });
  } finally { await h.close(); }
});

test('malformed expiry, unsupported dates and missing subscription do not mutate the plan', async () => {
  const h = await harness();
  try {
    for (const body of [{ plan: 'bad' }, { plan: 'vip', subscriptionExpiresAt: 'bad' }, { plan: 'vip', subscriptionExpiresAt: 123 },
      { plan: 'vip', subscriptionExpiresAt: '2040-01-01T00:00:00Z' }, { plan: 'vip', subscriptionExpiresAt: '1960-01-01T00:00:00Z' }]) {
      assert.equal((await h.request('/users/target/plan', 'PATCH', body)).status, 400);
    }
    assert.equal((await h.request('/users/missing/plan', 'PATCH', { plan: 'prime' })).status, 404);
    assert.deepEqual(h.changes, []);
  } finally { await h.close(); }
});
