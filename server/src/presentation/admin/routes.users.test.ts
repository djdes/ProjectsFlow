import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { adminRouter } from './routes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { UpdateUserAsAdmin } from '../../application/admin/UpdateUserAsAdmin.js';
import { DeleteUserAsAdmin, GetUserDeletionPreview } from '../../application/admin/DeleteUserAsAdmin.js';
import { SetUserPlanAsAdmin } from '../../application/admin/SetUserPlanAsAdmin.js';
import type { AdminRepository, AdminUpdateUserPatch } from '../../application/admin/AdminRepository.js';
import type { UserDeletionPlan, UserDeletionSnapshot } from '../../domain/user/userDeletion.js';
import type { UserRepository } from '../../application/user/UserRepository.js';
import type { PlanId } from '../../domain/usage/Plan.js';
import { effectivePlan, type Subscription } from '../../domain/usage/Subscription.js';
import { AdminUserError } from '../../domain/user/adminErrors.js';
import { ListAllUsers } from '../../application/admin/ListAllUsers.js';
import { BulkSetPlanAsAdmin } from '../../application/admin/BulkSetPlanAsAdmin.js';
import { SignOutUserEverywhere } from '../../application/admin/SignOutUserEverywhere.js';
import { SendPasswordResetAsAdmin } from '../../application/admin/SendPasswordResetAsAdmin.js';
import { GetAdminUserOverview } from '../../application/admin/GetAdminUserOverview.js';
import type { AdminAuditInput, AdminAuditLog } from '../../application/admin/AdminAuditLog.js';
import type { SessionRepository } from '../../application/session/SessionRepository.js';

const now = new Date('2026-10-29T12:00:00Z');
async function harness() {
  const profiles = new Map(['admin', 'target', 'other', 'admin2'].map((id) => [id, { id, displayName: id, email: `${id}@example.test`, isAdmin: id.startsWith('admin') }]));
  const subscriptions = new Map<string, Subscription>([
    ['target', { plan: 'prime', startedAt: new Date('2026-10-01T00:00:00Z'), expiresAt: new Date('2026-11-01T00:00:00Z') }],
    ['other', { plan: 'free', startedAt: null, expiresAt: null }],
  ]);
  const changes: string[] = [];
  const journal: AdminAuditInput[] = [];
  const liveSessions = new Map([['target', 2], ['admin', 1]]);
  const resetMails: string[] = [];
  const audit: AdminAuditLog = {
    record: async (entries) => { journal.push(...entries); },
    listForTarget: async (id) => journal.filter((e) => e.targetUserId === id).reverse()
      .map((e, i) => ({ id: `a${i}`, actorDisplayName: 'Админ', batchId: null, before: null, after: null, ...e, createdAt: now })),
  };
  const sessions = { deleteAllForUser: async (id: string) => { liveSessions.delete(id); } } as unknown as SessionRepository;
  const order = ['admin', 'target', 'other', 'admin2'];
  const viewOf = (id: string) => {
    const p = profiles.get(id)!;
    const sub = subscriptions.get(id);
    return {
      ...p, avatarUrl: null, projectCount: 0, ownedProjectCount: 0, delegationEnabledCount: 0, githubConnected: false,
      plan: sub?.plan ?? 'free', subscriptionExpiresAt: sub?.expiresAt ?? null, telegramLinked: id === 'other',
      telegramUsername: id === 'other' ? 'other_tg' : null, workspaceCount: 1, lastLoginAt: null,
      lastActivityAt: id === 'target' ? new Date('2026-10-28T00:00:00Z') : null,
      createdAt: new Date(Date.UTC(2026, order.indexOf(id), 1)), deletedAt: null,
    };
  };
  const snapshotOf = (id: string): UserDeletionSnapshot | null => {
    const user = profiles.get(id);
    return user ? { userId: id, isAdmin: user.isAdmin, workspaces: [], projects: [] } : null;
  };
  const repo = {
    updateUser: async (id: string, patch: AdminUpdateUserPatch, actor: string) => {
      const user = profiles.get(id);
      if (!user) throw new AdminUserError('user_not_found', 'Пользователь не найден');
      if ([...profiles.values()].some((p) => p.id !== id && p.email === patch.email)) throw new AdminUserError('email_taken', 'Эта почта уже используется');
      Object.assign(user, patch); changes.push(`update:${id}:${actor}`);
    },
    loadUserDeletionSnapshot: async (id: string) => snapshotOf(id),
    getUserProfile: async (id: string) => {
      const p = profiles.get(id);
      return p ? { ...p, avatarUrl: null, telegramLinked: false, telegramUsername: null } : null;
    },
    listAllUsers: async () => [...profiles.keys()].map(viewOf),
    loadUserOverview: async (id: string) => profiles.has(id) ? {
      workspaces: [], projects: [], usage: { costUsd30d: 1.5, costUsdTotal: 4, runs30d: 3 },
      activity: { tasksCreated30d: 2, comments30d: 5, activeSessions: liveSessions.get(id) ?? 0, lastLoginAt: null, lastSeenAt: null },
    } : null,
    deleteUser: async (id: string, actor: string, decide: (s: UserDeletionSnapshot) => UserDeletionPlan) => {
      const snapshot = snapshotOf(id);
      if (!snapshot) throw new AdminUserError('user_not_found', 'Пользователь не найден');
      const plan = decide(snapshot);
      profiles.delete(id); changes.push(`delete:${id}:${actor}`);
      return { plan, storageKeys: [] };
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
  let seq = 0;
  app.use('/admin', adminRouter({ updateUser: new UpdateUserAsAdmin(repo, audit), deleteUser: new DeleteUserAsAdmin({ repo, storage: { delete: async () => {} } as never, audit }),
    getUserDeletionPreview: new GetUserDeletionPreview(repo),
    setUserPlanAsAdmin: new SetUserPlanAsAdmin({ users, audit, now: () => now }),
    listAllUsers: new ListAllUsers(repo, () => now),
    bulkSetPlan: new BulkSetPlanAsAdmin({ users, audit, idGen: () => `batch-${++seq}`, now: () => now }),
    signOutEverywhere: new SignOutUserEverywhere({ repo, sessions, audit }),
    sendPasswordReset: new SendPasswordResetAsAdmin({ repo, audit, requestPasswordReset: { execute: async (email) => { resetMails.push(email); } } }),
    getUserOverview: new GetAdminUserOverview({ repo, audit, now: () => now }),
  } as never));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/admin`;
  return { profiles, subscriptions, changes, journal, liveSessions, resetMails,
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
      ['/users/target/deletion-preview', 'GET', undefined],
      ['/users/target/plan', 'PATCH', { plan: 'vip' }],
      ['/users', 'GET', undefined],
      ['/users/target/overview', 'GET', undefined],
      ['/users/target/sign-out-all', 'POST', undefined],
      ['/users/target/password-reset', 'POST', undefined],
      ['/users/bulk/plan', 'POST', { userIds: ['target'], plan: 'vip', term: { kind: 'extend', days: 30 } }],
    ] as const) {
      assert.equal((await h.request(path, method, body, '')).status, 401);
      assert.equal((await h.request(path, method, body, 'member')).status, 403);
    }
    assert.deepEqual(h.changes, []);
    assert.deepEqual(h.journal, []);
    assert.equal(h.resetMails.length, 0);
    assert.equal(h.liveSessions.get('target'), 2);
  } finally { await h.close(); }
});

test('profile changes normalize email/name, reject invalid data and conflicts, and report missing users', async () => {
  const h = await harness();
  try {
    for (const patch of [{}, { displayName: '  ' }, { displayName: 'x'.repeat(81) }, { email: 'broken' }, { isAdmin: 'true' }, { passwordHash: 'x' }, { avatarUrl: 'https://example.test/a' }, { telegram: false }]) {
      assert.equal((await h.request('/users/target', 'PATCH', patch)).status, 400);
    }
    assert.equal(h.changes.length, 0);
    assert.equal((await h.request('/users/target', 'PATCH', { displayName: '  Иван  ', email: ' NEW@Example.Test ', avatarUrl: null, telegram: null })).status, 204);
    assert.equal(h.profiles.get('target')!.email, 'new@example.test');
    assert.equal(h.profiles.get('target')!.displayName, 'Иван');
    assert.deepEqual(h.changes, ['update:target:admin']);
    assert.equal((await h.request('/users/target', 'PATCH', { email: 'other@example.test' })).status, 409);
    assert.equal((await h.request('/users/missing', 'PATCH', { displayName: 'Имя' })).status, 404);
    assert.equal((await h.request('/users/admin', 'PATCH', { isAdmin: false })).status, 409);
    assert.equal(h.profiles.get('admin')!.isAdmin, true);
  } finally { await h.close(); }
});

test('deletion rejects self-deletion and other admins, previews the plan and removes only the selected account', async () => {
  const h = await harness();
  try {
    assert.equal((await h.request('/users/admin', 'DELETE')).status, 409);
    const blocked = await h.request('/users/admin2', 'DELETE');
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json() as { error: string }).error, 'deletion_blocked');
    assert.equal(h.profiles.has('admin2'), true);
    const preview = await h.request('/users/admin2/deletion-preview', 'GET');
    assert.deepEqual((await preview.json() as { blockers: unknown }).blockers, [{ kind: 'admin' }]);
    assert.equal((await h.request('/users/missing/deletion-preview', 'GET')).status, 404);
    assert.equal((await h.request('/users/missing', 'DELETE')).status, 404);
    assert.equal((await h.request('/users/target', 'DELETE')).status, 200);
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

test('the users list searches, filters, sorts and pages on the server with counts per filter', async () => {
  const h = await harness();
  try {
    const list = async (qs: string) => (await (await h.request(`/users?${qs}`, 'GET')).json()) as {
      users: { id: string }[]; total: number; page: number; pageSize: number; counts: Record<string, number>;
    };
    const all = await list('');
    assert.deepEqual(all.users.map((u) => u.id), ['admin2', 'other', 'target', 'admin']); // newest first by default
    assert.equal(all.counts['admins'], 2);
    assert.equal(all.counts['expired'], 0);
    assert.equal(all.counts['prime'], 1);
    assert.equal(all.counts['telegram'], 1);
    assert.deepEqual((await list('filter=admins&sort=name&dir=asc')).users.map((u) => u.id), ['admin', 'admin2']);
    assert.deepEqual((await list('q=%40other_tg')).users.map((u) => u.id), ['other']);
    const paged = await list('sort=name&dir=asc&pageSize=2&page=2');
    assert.deepEqual([paged.total, paged.page, paged.users.map((u) => u.id)], [4, 2, ['other', 'target']]);
    // Bad parameters fall back to defaults instead of failing.
    assert.equal((await list('filter=nope&pageSize=-3&page=abc')).total, 4);
    assert.deepEqual((await list('filter=inactive&inactiveDays=7')).users.map((u) => u.id).sort(), ['admin', 'admin2', 'other']);
  } finally { await h.close(); }
});

test('bulk plan extends each running term from its own end, writes one journal batch and reports missing users', async () => {
  const h = await harness();
  try {
    const res = await h.request('/users/bulk/plan', 'POST', { userIds: ['target', 'other', 'missing', 'target'], plan: 'prime', term: { kind: 'extend', days: 30 } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { updated: 2, missing: ['missing'] });
    // Expired on 11-01 is still running at «now» (10-29): +30 days from its own end.
    assert.equal(h.subscriptions.get('target')!.expiresAt!.toISOString(), '2026-12-01T00:00:00.000Z');
    assert.equal(h.subscriptions.get('target')!.startedAt!.toISOString(), '2026-10-01T00:00:00.000Z');
    assert.equal(h.subscriptions.get('other')!.expiresAt!.getTime(), now.getTime() + 30 * 86400000);
    assert.deepEqual(h.journal.map((e) => [e.action, e.targetUserId, e.batchId, e.actorUserId]),
      [['bulk_plan', 'target', 'batch-1', 'admin'], ['bulk_plan', 'other', 'batch-1', 'admin']]);
    assert.deepEqual(h.journal[0]!.before, { plan: 'prime', expiresAt: '2026-11-01T00:00:00.000Z' });

    for (const body of [{ userIds: [], plan: 'prime', term: { kind: 'unlimited' } },
      { userIds: ['target'], plan: 'free', term: { kind: 'unlimited' } },
      { userIds: ['target'], plan: 'vip', term: { kind: 'extend', days: 0 } },
      { userIds: ['target'], plan: 'vip', term: { kind: 'until', date: '2020-01-01T00:00:00Z' } }]) {
      assert.equal((await h.request('/users/bulk/plan', 'POST', body)).status, 400);
    }
    assert.equal(h.journal.length, 2);
    assert.equal((await h.request('/users/bulk/plan', 'POST', { userIds: ['target'], plan: 'vip', term: { kind: 'until', date: '2027-03-01T00:00:00Z' } })).status, 200);
    assert.deepEqual(h.subscriptions.get('target'), { plan: 'vip', startedAt: now, expiresAt: new Date('2027-03-01T00:00:00Z') });
  } finally { await h.close(); }
});

test('sign-out-all ends the sessions of another user only; password reset mails the current address; both are journaled', async () => {
  const h = await harness();
  try {
    assert.equal((await h.request('/users/admin/sign-out-all', 'POST')).status, 409);
    assert.equal(h.liveSessions.get('admin'), 1);
    assert.equal((await h.request('/users/missing/sign-out-all', 'POST')).status, 404);
    assert.equal((await h.request('/users/target/sign-out-all', 'POST')).status, 204);
    assert.equal(h.liveSessions.has('target'), false);
    const reset = await h.request('/users/target/password-reset', 'POST');
    assert.deepEqual(await reset.json(), { email: 'target@example.test' });
    assert.deepEqual(h.resetMails, ['target@example.test']);
    assert.equal((await h.request('/users/missing/password-reset', 'POST')).status, 404);
    assert.deepEqual(h.journal.map((e) => e.action), ['sign_out_all', 'password_reset_sent']);
  } finally { await h.close(); }
});

test('profile, role, plan and deletion changes are journaled with before/after; the overview returns the history', async () => {
  const h = await harness();
  try {
    await h.request('/users/target', 'PATCH', { displayName: 'Иван', isAdmin: true });
    await h.request('/users/target', 'PATCH', { displayName: 'Иван' }); // no change, no entry
    await h.request('/users/target/plan', 'PATCH', { plan: 'vip', subscriptionExpiresAt: null });
    assert.deepEqual(h.journal.map((e) => [e.action, e.before, e.after]), [
      ['profile_update', { displayName: 'target' }, { displayName: 'Иван' }],
      ['role_change', { isAdmin: false }, { isAdmin: true }],
      ['plan_change', { plan: 'prime', expiresAt: '2026-11-01T00:00:00.000Z' }, { plan: 'vip', expiresAt: null }],
    ]);
    const overview = await (await h.request('/users/target/overview', 'GET')).json() as {
      user: { id: string }; usage: { costUsd30d: number }; history: { action: string; createdAt: string }[];
    };
    assert.equal(overview.user.id, 'target');
    assert.equal(overview.usage.costUsd30d, 1.5);
    assert.deepEqual(overview.history.map((e) => e.action), ['plan_change', 'role_change', 'profile_update']);
    assert.equal((await h.request('/users/missing/overview', 'GET')).status, 404);
    assert.equal((await h.request('/users/other', 'DELETE')).status, 200);
    const deletion = h.journal.at(-1)!;
    assert.equal(deletion.action, 'delete');
    assert.deepEqual(deletion.before, { email: 'other@example.test', displayName: 'other' });
  } finally { await h.close(); }
});
