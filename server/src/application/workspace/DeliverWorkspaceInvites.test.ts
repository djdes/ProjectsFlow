import test from 'node:test';
import assert from 'node:assert/strict';
import { DeliverWorkspaceInvites } from './DeliverWorkspaceInvites.js';
import type { WorkspaceInviteRepository } from './WorkspaceInviteRepository.js';
import type { WorkspaceInvite } from '../../domain/workspace/WorkspaceInvite.js';
import { renderWorkspaceInviteEmail } from '../notifications/emails/workspaceInviteEmail.js';

function fixture() {
  let now = new Date('2026-10-07T12:00:00Z');
  let row: WorkspaceInvite = { id: 'a30f5c12-7361-45c5-bf78-667d8f793b1a', workspaceId: 'ws', role: 'editor',
    token: 'secret', email: 'person@example.test', createdByUserId: 'owner', createdAt: now,
    expiresAt: new Date('2026-10-14'), acceptedAt: null, acceptedByUserId: null,
    delivery: { email: 'queued', site: 'queued', telegram: 'queued' }, deliveryNextAttemptAt: now,
  };
  const calls = { email: 0, site: 0, telegram: 0 };
  const settings = { emailFails: false, siteFails: false, lookupFails: false, registered: true, connected: true, emailConfigured: true, duplicateNotification: false };
  let notificationId = '';
  let telegramText = '';
  const repo = {
    async claimDelivery(time: Date) {
      if (row.acceptedAt || row.deliveryLockedAt || !row.deliveryNextAttemptAt || row.deliveryNextAttemptAt > time) return null;
      row = { ...row, deliveryLockedAt: time, lastSentAt: time, deliveryAttempts: (row.deliveryAttempts ?? 0) + 1 }; return row;
    },
    async finishDelivery(_id, _claim, delivery, nextAttemptAt) { row = { ...row, delivery, deliveryNextAttemptAt: nextAttemptAt, deliveryLockedAt: null }; },
  } as WorkspaceInviteRepository;
  const worker = () => new DeliverWorkspaceInvites({
    invites: repo, workspaces: { getById: async () => ({ name: 'Команда <script>' }) },
    users: { getById: async () => ({ displayName: 'Автор <b>' }), getByEmail: async () => { if (settings.lookupFails) throw new Error('lookup'); return settings.registered ? { id: 'user' } : null; } },
    notifications: { create: async input => { calls.site++; notificationId = input.id; if (settings.siteFails) throw new Error('DB'); if (settings.duplicateNotification) throw { cause: { code: 'ER_DUP_ENTRY' } }; } },
    email: { send: async () => { calls.email++; if (settings.emailFails) throw new Error('SMTP'); } },
    emailConfigured: settings.emailConfigured,
    telegram: { execute: async input => { calls.telegram++; telegramText = input.text; return settings.connected ? { status: 'ok', messageId: 1, chatId: 1 } : { status: 'not_connected' }; } },
    appUrl: 'https://app.test', now: () => now,
  });
  return { worker, settings, calls, get: () => row, notificationId: () => notificationId, telegramText: () => telegramText,
    advance: (ms: number) => { now = new Date(now.getTime() + ms); }, set: (patch: Partial<WorkspaceInvite>) => { row = { ...row, ...patch }; } };
}

test('SMTP failure does not suppress site and Telegram; restart retries only failed channel', async () => {
  const f = fixture(); f.settings.emailFails = true;
  await f.worker().run();
  assert.deepEqual(f.get().delivery, { email: 'failed', site: 'sent', telegram: 'sent' });
  assert.deepEqual(f.calls, { email: 1, site: 1, telegram: 1 });
  assert.ok(f.get().deliveryNextAttemptAt);
  f.advance(60_000); f.settings.emailFails = false;
  await f.worker().run();
  assert.deepEqual(f.calls, { email: 2, site: 1, telegram: 1 });
  assert.equal(f.get().deliveryNextAttemptAt, null);
  assert.equal(f.get().delivery?.email, 'sent');
});

test('site failure and recipient lookup failure are independent of SMTP', async () => {
  const f = fixture(); f.settings.siteFails = true;
  await f.worker().run();
  assert.deepEqual(f.get().delivery, { email: 'sent', site: 'failed', telegram: 'sent' });
  const g = fixture(); g.settings.lookupFails = true;
  await g.worker().run();
  assert.deepEqual(g.get().delivery, { email: 'sent', site: 'failed', telegram: 'failed' });
});

test('unconfigured SMTP is not recorded as a successful send; unregistered users receive email only', async () => {
  const f = fixture(); f.settings.emailConfigured = false; f.settings.connected = false;
  await f.worker().run();
  assert.deepEqual(f.get().delivery, { email: 'unavailable', site: 'sent', telegram: 'not_connected' });
  assert.equal(f.calls.email, 0);
  const g = fixture(); g.settings.registered = false;
  await g.worker().run();
  assert.deepEqual(g.get().delivery, { email: 'sent', site: 'not_registered', telegram: 'not_registered' });
  assert.deepEqual(g.calls, { email: 1, site: 0, telegram: 0 });
});

test('automatic attempts stop with a persistent failure status; simultaneous wakes send once', async () => {
  const f = fixture(); f.settings.emailFails = true;
  const worker = f.worker(); await Promise.all([worker.run(), worker.run()]);
  for (const wait of [60_000, 300_000, 900_000, 3_600_000]) { f.advance(wait); await worker.run(); }
  assert.equal(f.calls.email, 5); assert.equal(f.calls.site, 1);
  assert.equal(f.get().deliveryNextAttemptAt, null); assert.equal(f.get().delivery?.email, 'failed');
});

test('notification acknowledgement retries are idempotent; names are escaped in external messages', async () => {
  const f = fixture(); f.settings.duplicateNotification = true;
  await f.worker().run();
  assert.equal(f.get().delivery?.site, 'sent');
  assert.match(f.notificationId(), /^[a-f\d-]{36}$/);
  assert.doesNotMatch(f.telegramText(), /<script>|Автор <b>/);
  const html = renderWorkspaceInviteEmail({ to: 'x@example.test', workspaceName: '<img>', actorDisplayName: '<script>', role: 'editor', acceptUrl: 'https://app.test/invite/x' }).html;
  assert.doesNotMatch(html, /<img>|<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('accepted or revoked invitations are not sent by a later worker', async () => {
  const f = fixture(); f.set({ acceptedAt: new Date() }); await f.worker().run();
  assert.deepEqual(f.calls, { email: 0, site: 0, telegram: 0 });
});
