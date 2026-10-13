import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PairTelegramAccount, TelegramAccountConnectedError, TelegramPairingUnavailableError } from './PairTelegramAccount.js';
import type { TelegramPairingRepository } from './TelegramPairingRepository.js';
import { HandleTelegramWebhook } from './HandleTelegramWebhook.js';

const now = new Date('2026-10-13T12:00:00Z');
function harness() {
  const issued: Parameters<TelegramPairingRepository['issue']>[0][] = [];
  const completed: Parameters<TelegramPairingRepository['complete']>[0][] = [];
  const revoked: string[] = [];
  const repository: TelegramPairingRepository = {
    issue: async (input) => { issued.push(input); return true; },
    complete: async (input) => { completed.push(input); return 'connected'; },
    revoke: async (id) => { revoked.push(id); },
  };
  const service = new PairTelegramAccount({ repository, enabled: true, botUsername: '@Example_Bot', now: () => now });
  return { service, repository, issued, completed, revoked };
}

test('pairing issues distinct 256-bit secrets, stores only hashes and expires after ten minutes', async () => {
  const h = harness();
  const first = await h.service.start('account-a');
  const second = await h.service.start('account-a');
  const url = new URL(first.url);
  assert.equal(url.origin, 'https://t.me');
  assert.equal(url.pathname, '/Example_Bot');
  const payload = url.searchParams.get('start')!;
  assert.match(payload, /^connect_[A-Za-z0-9_-]{43}$/);
  assert.ok(payload.length <= 64);
  assert.notEqual(first.url, second.url);
  assert.equal(first.expiresAt, '2026-10-13T12:10:00.000Z');
  assert.deepEqual(h.issued[0], {
    userId: 'account-a', tokenHash: createHash('sha256').update(payload.slice(8)).digest('hex'),
    expiresAt: new Date(first.expiresAt),
  });
  assert.ok(!JSON.stringify(h.issued).includes(payload.slice(8)));
});

test('unavailable bot and an already connected website account cannot issue a link', async () => {
  const h = harness();
  for (const config of [{ enabled: false, botUsername: 'Bot' }, { enabled: true, botUsername: null }, { enabled: true, botUsername: 'bad/bot' }]) {
    await assert.rejects(new PairTelegramAccount({ repository: h.repository, ...config }).start('a'), TelegramPairingUnavailableError);
  }
  assert.equal(h.issued.length, 0);
  h.repository.issue = async () => false;
  await assert.rejects(h.service.start('a'), TelegramAccountConnectedError);
});

test('only matching private Telegram sender/chat can redeem a well-formed token', async () => {
  const h = harness();
  const payload = new URL((await h.service.start('a')).url).searchParams.get('start')!;
  const input = { payload, chatType: 'private', chatId: 123, from: { id: 123, username: 'tester', first_name: 'Тест' } };
  for (const patch of [{ chatType: 'group' }, { chatType: 'channel' }, { chatId: 456 }, { from: { id: -1 } }, { payload: 'connect_guess' }]) {
    assert.equal(await h.service.complete({ ...input, ...patch }), 'expired');
  }
  assert.equal(h.completed.length, 0);
  assert.equal(await h.service.complete(input), 'connected');
  assert.equal(h.completed[0]!.telegramUserId, 123);
  assert.equal(h.completed[0]!.telegramUsername, 'tester');
  assert.equal(h.completed[0]!.tokenHash, h.issued[0]!.tokenHash);
  assert.equal(h.completed[0]!.now, now);
});

test('expired and conflicting links never report successful connection', async () => {
  const h = harness();
  const payload = new URL((await h.service.start('a')).url).searchParams.get('start')!;
  for (const result of ['expired', 'already_linked'] as const) {
    h.repository.complete = async () => result;
    assert.equal(await h.service.complete({ payload, chatType: 'private', chatId: 123, from: { id: 123 } }), result);
  }
  await h.service.revoke('a');
  assert.deepEqual(h.revoked, ['a']);
});

for (const result of ['connected', 'expired', 'already_linked'] as const) {
  test(`bot connection command: ${result}, no accidental task/comment creation`, async () => {
    const calls: unknown[] = [], sent: string[] = [];
    const handler = new HandleTelegramWebhook({
      pairing: { complete: async (input: unknown) => { calls.push(input); return result; } },
      client: { sendMessage: async ({ text }: { text: string }) => { sent.push(text); return { kind: 'ok' }; } },
    } as never);
    const message = { message_id: 1, from: { id: 123 }, chat: { id: 123, type: 'private' }, text: `/start connect_${'a'.repeat(43)}`, reply_to_message: { message_id: 9 } };
    await handler.execute({ update_id: 1, message });
    assert.equal(calls.length, 1);
    assert.equal(sent.length, 1);
    assert.match(sent[0]!, result === 'connected' ? /Telegram подключён/ : result === 'expired' ? /устарела/ : /уже подключён/);
    await handler.execute({ update_id: 2, message: { ...message, chat: { id: -123, type: 'supergroup' } } });
    assert.equal(calls.length, 1);
    assert.equal(sent.length, 1);
  });
}
