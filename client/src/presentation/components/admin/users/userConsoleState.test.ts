import assert from 'node:assert/strict';
import test from 'node:test';
import type { AdminAuditEntry, AdminUser } from '@/application/admin/AdminRepository';
import {
  DEFAULT_CONSOLE_STATE, activityText, auditText, parseConsoleState, planBadge, toListQuery, updateConsoleState,
  usersToCsv, writeConsoleState,
} from './userConsoleState';

const now = Date.parse('2026-11-04T12:00:00Z');
const user: AdminUser = {
  id: 'u1', email: 'ivan@example.test', displayName: 'Иван', avatarUrl: null, isAdmin: false, projectCount: 3,
  ownedProjectCount: 1, delegationEnabledCount: 0, githubConnected: false, plan: 'prime',
  subscriptionExpiresAt: '2026-11-07T12:00:00Z', telegramLinked: true, telegramUsername: 'ivan', workspaceCount: 2,
  lastLoginAt: null, lastActivityAt: '2026-11-04T11:55:00Z', createdAt: '2025-01-01T00:00:00Z', deletedAt: null,
};

test('URL state: defaults stay out of the URL, other params survive, garbage falls back', () => {
  const base = new URLSearchParams('tab=users&user=u1');
  assert.equal(writeConsoleState(base, DEFAULT_CONSOLE_STATE).toString(), 'tab=users&user=u1');
  const state = { ...DEFAULT_CONSOLE_STATE, q: 'ив', filter: 'vip' as const, sort: 'name' as const, dir: 'asc' as const, page: 3 };
  const written = writeConsoleState(base, state);
  // asc is the default direction for name, so it is not written.
  assert.equal(written.toString(), 'tab=users&user=u1&q=%D0%B8%D0%B2&f=vip&sort=name&page=3');
  assert.deepEqual(parseConsoleState(written), state);
  assert.deepEqual(parseConsoleState(new URLSearchParams('f=gold&sort=x&dir=up&page=-1&idle=abc')), DEFAULT_CONSOLE_STATE);
  assert.equal(parseConsoleState(new URLSearchParams('sort=expiry')).dir, 'asc');
});

test('changing search, filter or sort goes back to page 1 and picks the natural direction', () => {
  const on3 = { ...DEFAULT_CONSOLE_STATE, page: 3 };
  assert.equal(updateConsoleState(on3, { q: 'a' }).page, 1);
  assert.equal(updateConsoleState(on3, { page: 4 }).page, 4);
  assert.equal(updateConsoleState(on3, { q: '' }).page, 3); // nothing changed
  assert.deepEqual(updateConsoleState(on3, { sort: 'name' }), { ...DEFAULT_CONSOLE_STATE, sort: 'name', dir: 'asc', page: 1 });
  assert.equal(toListQuery({ ...on3, q: '  ив ' }).q, 'ив');
});

test('plan badge: days left under a week, expired, unlimited, free', () => {
  assert.deepEqual(planBadge(user, now), { label: 'Прайм · 3 дня', tone: 'pf-tone-yellow', title: 'Прайм до 07.11.2026' });
  assert.equal(planBadge({ plan: 'vip', subscriptionExpiresAt: '2027-01-10T00:00:00Z' }, now).label, 'VIP до 10.01.2027');
  assert.equal(planBadge({ plan: 'vip', subscriptionExpiresAt: '2026-10-01T00:00:00Z' }, now).tone, 'pf-tone-red');
  assert.equal(planBadge({ plan: 'prime', subscriptionExpiresAt: null }, now).label, 'Прайм · бессрочно');
  assert.equal(planBadge({ plan: 'free', subscriptionExpiresAt: null }, now).label, 'Free');
});

test('activity text', () => {
  assert.equal(activityText(null, now), 'нет данных');
  assert.equal(activityText('2026-11-04T11:55:00Z', now), '5 мин назад');
  assert.equal(activityText('2026-11-02T12:00:00Z', now), '2 дня назад');
  assert.equal(activityText('2026-08-01T12:00:00Z', now), '01.08.2026');
});

test('CSV: BOM, semicolons, quoting and formula neutralization', () => {
  const csv = usersToCsv([user, { ...user, id: 'u2', displayName: '=HYPERLINK("x")', email: 'a;b@example.test', telegramLinked: false }]);
  assert.ok(csv.startsWith(String.fromCharCode(0xfeff) + 'Имя;Почта;'));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 3);
  assert.ok(lines[1]!.startsWith('Иван;ivan@example.test;prime;2026-11-07T12:00:00Z;нет;ivan;3;2;'));
  assert.ok(lines[2]!.startsWith(`"'=HYPERLINK(""x"")";"a;b@example.test";`));
});

test('journal lines read as sentences', () => {
  const entry = (patch: Partial<AdminAuditEntry>): AdminAuditEntry => ({
    id: 'e', actorUserId: 'a', actorDisplayName: 'Админ', action: 'plan_change', batchId: null, before: null, after: null,
    createdAt: '2026-11-04T00:00:00Z', ...patch,
  });
  assert.equal(auditText(entry({ before: { plan: 'free', expiresAt: null }, after: { plan: 'vip', expiresAt: '2026-12-01T00:00:00Z' } })),
    'Тариф: Бесплатный → VIP до 01.12.2026');
  assert.equal(auditText(entry({ action: 'bulk_plan', before: { plan: 'prime', expiresAt: null }, after: { plan: 'prime', expiresAt: null, batchSize: 3 } })),
    'Тариф (массово, 3 пользователя): Прайм бессрочно → Прайм бессрочно');
  assert.equal(auditText(entry({ action: 'profile_update', before: { email: 'a@x.test', telegram: '@ivan' }, after: { email: 'b@x.test', telegram: null } })),
    'Профиль: почта: a@x.test → b@x.test, отвязан Telegram @ivan');
  assert.equal(auditText(entry({ action: 'role_change', after: { isAdmin: false } })), 'Сняты права администратора');
});
