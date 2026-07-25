import assert from 'node:assert/strict';
import test from 'node:test';
import { SendWorkspaceCommitReview } from './SendWorkspaceCommitReview.js';
import type { CommitReviewResult } from './CommitReviewResult.js';

const NOW = new Date('2026-07-24T13:00:00Z'); // 16:00 MSK — дата 24.07.2026

function harness(telegramOverrides: Record<string, unknown> = {}) {
  const rich: Array<{ chatId: number; html: string }> = [];
  const plain: Array<{ chatId: number; text: string }> = [];
  const attached: Array<{ tokens: string[]; messageKind: string; chatId: number }> = [];
  const service = new SendWorkspaceCommitReview({
    telegram: {
      async sendRichMessage(input: { chatId: number; html: string }) {
        rich.push(input);
        return { kind: 'ok' as const, messageId: 42 };
      },
      async sendMessage(input: { chatId: number; text: string }) {
        plain.push(input);
        return { kind: 'ok' as const, messageId: 43 };
      },
      ...telegramOverrides,
    } as never,
    telegramDigestActions: {
      async attach(input: { tokens: string[]; messageKind: string; chatId: number }) {
        attached.push(input);
      },
    } as never,
  });
  return { service, rich, plain, attached };
}

function autoResult(name: string, title: string): CommitReviewResult {
  return {
    chatId: -100,
    projectName: name,
    mode: 'auto',
    rows: [{ title, openUrl: 'https://app/open', completeUrl: null }],
  };
}

function proposeResult(name: string, title: string, token: string): CommitReviewResult {
  return {
    chatId: -100,
    projectName: name,
    mode: 'propose',
    rows: [
      {
        title,
        openUrl: 'https://app/open',
        completeUrl: `https://app/api/telegram-digest-actions/${token}`,
      },
    ],
  };
}

test('empty results → nothing sent', async () => {
  const h = harness();
  assert.equal(await h.service.execute({ chatId: -100, results: [], now: NOW }), false);
  assert.equal(h.rich.length, 0);
  assert.equal(h.plain.length, 0);
});

test('two projects (auto + propose) collapse into ONE message with two <details>', async () => {
  const h = harness();
  const token = 'd'.repeat(32);
  const ok = await h.service.execute({
    chatId: -100,
    results: [autoResult('OrdersFlow', 'Экспорт заказов'), proposeResult('DocsFlow', 'Проверить обработку', token)],
    now: NOW,
  });

  assert.equal(ok, true);
  assert.equal(h.rich.length, 1);
  const html = h.rich[0]!.html;
  // Один заголовок дайджеста с датой.
  assert.match(html, /Сверка коммитов · 24\.07\.2026/);
  // Ровно два сворачиваемых блока.
  assert.equal(html.match(/<details>/g)?.length, 2);
  // Режимы подписаны раздельно.
  assert.match(html, /OrdersFlow · 1 задача · закрыто/);
  assert.match(html, /DocsFlow · 1 задача · предложено закрыть/);
  // Задачи и действия сохранены.
  assert.match(html, /Экспорт заказов/);
  assert.match(html, /Проверить обработку/);
  assert.match(html, new RegExp(`/api/telegram-digest-actions/${token}`));
  // Токен propose-проекта запомнен, auto-проект токенов не даёт.
  assert.equal(h.attached.length, 1);
  assert.deepEqual(h.attached[0]!.tokens, [token]);
  assert.equal(h.attached[0]!.messageKind, 'rich');
});

test('fallback builds one HTML message with a blockquote per project', async () => {
  const h = harness({ sendRichMessage: undefined });
  const ok = await h.service.execute({
    chatId: -100,
    results: [autoResult('OrdersFlow', 'Экспорт'), autoResult('DocsFlow', 'Импорт')],
    now: NOW,
  });
  assert.equal(ok, true);
  assert.equal(h.rich.length, 0);
  assert.equal(h.plain.length, 1);
  const text = h.plain[0]!.text;
  assert.match(text, /Сверка коммитов · 24\.07\.2026/);
  assert.equal(text.match(/<blockquote expandable>/g)?.length, 2);
  assert.match(text, /OrdersFlow · закрыто/);
  assert.match(text, /DocsFlow · закрыто/);
  assert.equal(h.attached[0]!.messageKind, 'html');
});
