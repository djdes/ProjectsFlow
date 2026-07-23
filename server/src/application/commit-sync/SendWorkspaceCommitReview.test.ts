import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultWorkspaceAssigneeDigestSettings } from '../../domain/digest/WorkspaceAssigneeDigestSettings.js';
import { SendWorkspaceCommitReview } from './SendWorkspaceCommitReview.js';

function groupSettings() {
  return {
    ...defaultWorkspaceAssigneeDigestSettings('w1'),
    commitSyncEnabled: true,
    telegramGroupChatId: -100,
    projectMode: 'all' as const,
  };
}

test('auto summary lists closed drafts without a confirm button', async () => {
  const rich: Array<{ html: string }> = [];
  const attached: string[][] = [];
  const service = new SendWorkspaceCommitReview({
    settings: { async get() { return groupSettings(); } } as never,
    projects: {
      async getById() { return { id: 'p1', name: 'OrdersFlow' }; },
      async getWorkspaceId() { return 'w1'; },
    } as never,
    tasks: {
      // В auto-режиме задача уже закрыта (status='done') — кнопка ✓ не нужна.
      async getById() {
        return { id: 't1', projectId: 'p1', status: 'done', description: 'Экспорт заказов' };
      },
    } as never,
    createEmailActionToken: {
      async execute() { throw new Error('auto режим не должен создавать complete-токен'); },
    } as never,
    telegramDigestActions: {
      async attach(input: { tokens: string[] }) { attached.push(input.tokens); },
    } as never,
    telegram: {
      async sendRichMessage(input: { html: string }) {
        rich.push(input);
        return { kind: 'ok' as const, messageId: 9 };
      },
      async sendMessage() { throw new Error('fallback must not be used'); },
    } as never,
    appUrl: 'https://projectsflow.ru',
  });

  assert.equal(
    await service.execute({
      projectId: 'p1',
      dispatcherUserId: 'u1',
      mode: 'auto',
      matches: [{ taskId: 't1', commitSha: 'a'.repeat(40), reason: 'реализует' }],
    }),
    true,
  );

  assert.equal(rich.length, 1);
  assert.match(rich[0]!.html, /Закрыто по коммитам/);
  assert.match(rich[0]!.html, /Экспорт заказов/);
  assert.doesNotMatch(rich[0]!.html, /✓ закрыть/);
  assert.doesNotMatch(rich[0]!.html, /Значимые коммиты|verdict|⚠️/);
  assert.deepEqual(attached, [[]]);
});

test('propose summary lists proposed drafts with a confirm link', async () => {
  const rich: Array<{ html: string }> = [];
  const attached: string[][] = [];
  const token = 'd'.repeat(32);
  const service = new SendWorkspaceCommitReview({
    settings: { async get() { return groupSettings(); } } as never,
    projects: {
      async getById() { return { id: 'p1', name: 'OrdersFlow' }; },
      async getWorkspaceId() { return 'w1'; },
    } as never,
    tasks: {
      async getById() {
        return { id: 't1', projectId: 'p1', status: 'backlog', description: 'Проверить обработку заказа' };
      },
    } as never,
    createEmailActionToken: { async execute() { return token; } } as never,
    telegramDigestActions: {
      async attach(input: { tokens: string[] }) { attached.push(input.tokens); },
    } as never,
    telegram: {
      async sendRichMessage(input: { html: string }) {
        rich.push(input);
        return { kind: 'ok' as const, messageId: 9 };
      },
      async sendMessage() { throw new Error('fallback must not be used'); },
    } as never,
    appUrl: 'https://projectsflow.ru',
  });

  assert.equal(
    await service.execute({
      projectId: 'p1',
      dispatcherUserId: 'u1',
      mode: 'propose',
      matches: [{ taskId: 't1', commitSha: 'a'.repeat(40), reason: 'реализует' }],
    }),
    true,
  );

  assert.equal(rich.length, 1);
  assert.match(rich[0]!.html, /Предложено закрыть/);
  assert.match(rich[0]!.html, /Проверить обработку заказа/);
  assert.match(rich[0]!.html, new RegExp(`/api/telegram-digest-actions/${token}`));
  assert.match(rich[0]!.html, /✓ закрыть/);
  assert.deepEqual(attached, [[token]]);
});

test('summary stays silent when there is nothing to report', async () => {
  let sent = 0;
  const service = new SendWorkspaceCommitReview({
    settings: { async get() { return groupSettings(); } } as never,
    projects: {
      async getById() { return { id: 'p1', name: 'OrdersFlow' }; },
      async getWorkspaceId() { return 'w1'; },
    } as never,
    tasks: { async getById() { return null; } } as never,
    createEmailActionToken: { async execute() { return 'unused'; } } as never,
    telegramDigestActions: { async attach() {} } as never,
    telegram: {
      async sendRichMessage() { sent += 1; return { kind: 'ok' as const, messageId: sent }; },
      async sendMessage() { sent += 1; return { kind: 'ok' as const, messageId: sent }; },
    } as never,
    appUrl: 'https://projectsflow.ru',
  });

  // Пустой список совпадений — молчок.
  assert.equal(
    await service.execute({ projectId: 'p1', dispatcherUserId: 'u1', mode: 'auto', matches: [] }),
    false,
  );
  // Задача не нашлась (getById → null) — тоже молчок.
  assert.equal(
    await service.execute({
      projectId: 'p1',
      dispatcherUserId: 'u1',
      mode: 'auto',
      matches: [{ taskId: 'gone', commitSha: 'x', reason: 'r' }],
    }),
    false,
  );
  assert.equal(sent, 0);
});
