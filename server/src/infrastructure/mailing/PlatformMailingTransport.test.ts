import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SendAgentNotificationResult } from '../../application/telegram/SendAgentTelegramNotification.js';
import { PlatformMailingTransport } from './PlatformMailingTransport.js';
import { exampleJob } from '../../../test/mailingHarness.js';
import { renderMailing } from '../../application/mailing/renderMailing.js';

test('email transport uses stable message IDs and one-click unsubscribe headers', async () => {
  const messages: unknown[] = [];
  const transport = new PlatformMailingTransport({ email: { send: async value => { messages.push(value); } }, emailConfigured: true,
    notifications: { create: async () => {} }, telegram: { execute: async () => ({ status: 'ok', messageId: 1, chatId: 1 }) }, telegramConfigured: true });
  const job = exampleJob(); const rendered = renderMailing(job.content, job);
  const unsubscribe = 'https://projectsflow.ru/api/mailings/unsubscribe/' + 'a'.repeat(64);
  assert.equal(await transport.send(job, rendered, unsubscribe), 'sent');
  assert.deepEqual(messages[0], { to: job.email, ...{ subject: rendered.subject, html: rendered.html, text: rendered.text },
    messageId: '<mailing-delivery@projectsflow.ru>', headers: { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } });
  await transport.send(job, rendered, ''); assert.equal('headers' in (messages[1] as object), false);
  assert.equal(await transport.send({ ...job, email: null }, rendered, ''), 'skipped');
});

test('site transport is idempotent by delivery ID and does not mask other database failures', async () => {
  const values: unknown[] = []; let duplicate = false; let unavailable = false;
  const transport = new PlatformMailingTransport({ email: { send: async () => {} }, emailConfigured: false,
    notifications: { create: async value => { values.push(value); if (unavailable) throw new Error('database unavailable'); if (duplicate) throw { cause: { code: 'ER_DUP_ENTRY' } }; } },
    telegram: { execute: async () => ({ status: 'ok', messageId: 1, chatId: 1 }) }, telegramConfigured: false });
  const job = exampleJob({ channel: 'site' }); const rendered = renderMailing(job.content, job);
  await transport.send(job, rendered, ''); duplicate = true;
  assert.equal(await transport.send(job, rendered, ''), 'sent');
  assert.deepEqual(values[0], { id: job.id, userId: job.userId, payload: { type: 'platform_message', campaignId: job.campaignId, title: rendered.subject, body: rendered.text, url: rendered.buttonUrl } });
  assert.equal(await transport.send({ ...job, userId: null }, rendered, ''), 'skipped');
  unavailable = true; await assert.rejects(() => transport.send(job, rendered, ''), /database unavailable/);
});

test('Telegram text is truncated before HTML escaping and disconnected users are skipped', async () => {
  let result: SendAgentNotificationResult = { status: 'ok', messageId: 1, chatId: 1 }; let message = '';
  const transport = new PlatformMailingTransport({ email: { send: async () => {} }, emailConfigured: false,
    notifications: { create: async () => {} }, telegramConfigured: true,
    telegram: { execute: async input => { message = input.text; return result; } } });
  const job = exampleJob({ channel: 'telegram' }); const rendered = { ...renderMailing(job.content, job), subject: '<A&B>', text: '&'.repeat(2999) + '😀' };
  assert.equal(await transport.send(job, rendered, ''), 'sent');
  assert.match(message, /^<b>&lt;A&amp;B&gt;<\/b>/); assert.equal(message.endsWith('&amp;'), true); assert.equal(message.includes('\ud83d'), false);
  result = { status: 'not_connected' }; assert.equal(await transport.send(job, rendered, ''), 'skipped');
  result = { status: 'error', description: 'private error' }; await assert.rejects(() => transport.send(job, rendered, ''), /mailing_telegram_delivery_failed/);
});
