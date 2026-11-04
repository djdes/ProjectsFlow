import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_ADMIN_USER_QUERY, adminPlanState, queryAdminUsers, type AdminDirectoryRow } from './adminUserDirectory.js';

const now = new Date('2026-11-04T12:00:00Z');
const day = (offset: number): Date => new Date(now.getTime() + offset * 86400000);
const row = (id: string, patch: Partial<AdminDirectoryRow> = {}): AdminDirectoryRow => ({
  id, email: `${id}@example.test`, displayName: id, telegramUsername: null, isAdmin: false, telegramLinked: false,
  plan: 'free', subscriptionExpiresAt: null, lastActivityAt: day(-1), createdAt: day(-100), deletedAt: null, ...patch,
});
const rows = [
  row('Борис', { plan: 'vip', subscriptionExpiresAt: day(10), createdAt: day(-5), lastActivityAt: day(-40) }),
  row('анна', { plan: 'prime', subscriptionExpiresAt: day(-1), isAdmin: true, createdAt: day(-50) }),
  row('Вера', { plan: 'prime', subscriptionExpiresAt: null, telegramLinked: true, telegramUsername: 'vera_tg', lastActivityAt: null }),
  row('Глеб', { plan: 'vip', subscriptionExpiresAt: day(3), createdAt: day(-1) }),
  row('Удалённый', { deletedAt: day(-2) }),
];
const q = (patch: Partial<typeof DEFAULT_ADMIN_USER_QUERY>) => ({ ...DEFAULT_ADMIN_USER_QUERY, ...patch });
const ids = (patch: Partial<typeof DEFAULT_ADMIN_USER_QUERY>) => queryAdminUsers(rows, q(patch), now).items.map((r) => r.id);

test('plan state reads a lapsed term as expired and no date as unlimited', () => {
  assert.equal(adminPlanState(rows[0]!, now), 'vip');
  assert.equal(adminPlanState(rows[1]!, now), 'expired');
  assert.equal(adminPlanState(rows[2]!, now), 'prime');
  assert.equal(adminPlanState(rows[4]!, now), 'free');
});

test('counts per filter follow the search and leave deleted accounts to their own filter', () => {
  const page = queryAdminUsers(rows, q({}), now);
  assert.equal(page.total, 4);
  assert.deepEqual(page.counts, { all: 4, free: 0, prime: 1, vip: 2, expired: 1, admins: 1, telegram: 1, inactive: 2, deleted: 1 });
  const searched = queryAdminUsers(rows, q({ q: '@VERA' }), now);
  assert.deepEqual(searched.items.map((r) => r.id), ['Вера']);
  assert.equal(searched.counts.all, 1);
  assert.equal(searched.counts.vip, 0);
  assert.deepEqual(ids({ q: 'example.test', filter: 'deleted' }), ['Удалённый']);
});

test('inactive means no activity within N days or never', () => {
  assert.deepEqual(ids({ filter: 'inactive', sort: 'name', dir: 'asc' }), ['Борис', 'Вера']);
  assert.deepEqual(ids({ filter: 'inactive', inactiveDays: 60, sort: 'name', dir: 'asc' }), ['Вера']);
});

test('sorting: Russian collation by name, missing activity and free/expired terms go last both ways', () => {
  assert.deepEqual(ids({ sort: 'name', dir: 'asc' }), ['анна', 'Борис', 'Вера', 'Глеб']);
  assert.deepEqual(ids({ sort: 'created', dir: 'desc' }), ['Глеб', 'Борис', 'анна', 'Вера']);
  assert.deepEqual(ids({ sort: 'activity', dir: 'desc' }).at(-1), 'Вера');
  assert.deepEqual(ids({ sort: 'activity', dir: 'asc' }).at(-1), 'Вера');
  assert.deepEqual(ids({ sort: 'expiry', dir: 'asc' }), ['Глеб', 'Борис', 'Вера', 'анна']);
  assert.deepEqual(ids({ sort: 'expiry', dir: 'desc' }), ['Вера', 'Борис', 'Глеб', 'анна']);
});

test('pages clamp to the available range', () => {
  const page = queryAdminUsers(rows, q({ sort: 'name', dir: 'asc', pageSize: 3, page: 9 }), now);
  assert.deepEqual([page.page, page.pageSize, page.items.map((r) => r.id)], [2, 3, ['Глеб']]);
  assert.equal(queryAdminUsers([], q({ page: 5 }), now).page, 1);
  assert.equal(queryAdminUsers(rows, q({ pageSize: 10_000 }), now).pageSize, 500);
});
