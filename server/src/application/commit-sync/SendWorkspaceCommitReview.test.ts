import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultWorkspaceAssigneeDigestSettings } from '../../domain/digest/WorkspaceAssigneeDigestSettings.js';
import { SendWorkspaceCommitReview } from './SendWorkspaceCommitReview.js';

test('commit review mentions only the author needing attention and has in-table task actions', async () => {
  const rich: Array<{ html: string; replyMarkup?: unknown }> = [];
  const attached: string[][] = [];
  const actionToken = 'd'.repeat(32);
  const service = new SendWorkspaceCommitReview({
    settings: {
      async get() {
        return {
          ...defaultWorkspaceAssigneeDigestSettings('w1'),
          commitSyncEnabled: true,
          telegramGroupChatId: -100,
          projectMode: 'all' as const,
        };
      },
    } as never,
    projects: {
      async getById() {
        return { id: 'p1', name: 'OrdersFlow' };
      },
      async getWorkspaceId() {
        return 'w1';
      },
    } as never,
    members: {
      async listByProject() {
        return [
          { userId: 'u1', user: { displayName: 'Анна' } },
          { userId: 'u2', user: { displayName: 'Борис' } },
        ];
      },
    } as never,
    githubTokens: {
      async getByUserId(userId: string) {
        return { githubLogin: userId === 'u1' ? 'anna-dev' : 'boris-dev' };
      },
    } as never,
    users: {
      async getTelegramLink(userId: string) {
        return {
          telegramUserId: userId === 'u1' ? 101 : 102,
          telegramUsername: userId === 'u1' ? 'anna_pf' : 'boris_pf',
        };
      },
    } as never,
    tasks: {
      async getById() {
        return {
          id: 't1',
          projectId: 'p1',
          status: 'todo',
          description: 'Проверить обработку заказа',
        };
      },
    } as never,
    createEmailActionToken: {
      async execute() {
        return actionToken;
      },
    } as never,
    telegramDigestActions: {
      async attach(input: { tokens: string[] }) {
        attached.push(input.tokens);
      },
    } as never,
    telegram: {
      async sendRichMessage(input: any) {
        rich.push(input);
        return { kind: 'ok' as const, messageId: 9 };
      },
      async sendMessage() {
        throw new Error('fallback must not be used');
      },
    } as never,
    appUrl: 'https://projectsflow.ru',
  });

  const commits = {
    ['a'.repeat(40)]: {
      committedAt: '2026-07-17T10:00:00.000Z',
      message: 'risky change',
      htmlUrl: 'https://github.test/a',
      authorName: 'Anna Git',
      authorLogin: 'anna-dev',
    },
    ['b'.repeat(40)]: {
      committedAt: '2026-07-17T11:00:00.000Z',
      message: 'good change',
      htmlUrl: 'https://github.test/b',
      authorName: 'Boris Git',
      authorLogin: 'boris-dev',
    },
  };
  assert.equal(
    await service.execute({
      projectId: 'p1',
      dispatcherUserId: 'u1',
      commits,
      matches: [{ taskId: 't1', commitSha: 'a'.repeat(40), reason: 'matches' }],
      reviews: [
        { commitSha: 'a'.repeat(40), verdict: 'attention', summary: 'Нужно проверить откат.' },
        { commitSha: 'b'.repeat(40), verdict: 'good', summary: 'Изменение аккуратное.' },
      ],
      overallSummary: 'Один коммит требует проверки.',
    }),
    true,
  );

  assert.equal(rich.length, 1);
  assert.match(rich[0]!.html, /@anna_pf/);
  assert.doesNotMatch(rich[0]!.html, /@boris_pf/);
  assert.doesNotMatch(rich[0]!.html, /Борис/);
  assert.doesNotMatch(rich[0]!.html, /Изменение аккуратное/);
  assert.match(rich[0]!.html, /Проверить обработку заказа/);
  assert.match(rich[0]!.html, new RegExp(`/api/telegram-digest-actions/${actionToken}`));
  assert.match(rich[0]!.html, />✓<\/a> · <a [^>]+>↗<\/a>/);
  assert.equal(rich[0]!.replyMarkup, undefined);
  assert.deepEqual(attached, [[actionToken]]);
});

test('commit review stays silent without commits and sends one short all-good message for clean commits', async () => {
  let sent = 0;
  const html: string[] = [];
  const service = new SendWorkspaceCommitReview({
    settings: {
      async get() {
        return {
          ...defaultWorkspaceAssigneeDigestSettings('w1'),
          commitSyncEnabled: true,
          telegramGroupChatId: -100,
          projectMode: 'all' as const,
        };
      },
    } as never,
    projects: {
      async getById() {
        return { id: 'p1', name: 'OrdersFlow' };
      },
      async getWorkspaceId() {
        return 'w1';
      },
    } as never,
    members: { async listByProject() { return []; } } as never,
    githubTokens: { async getByUserId() { return null; } } as never,
    users: { async getTelegramLink() { return null; } } as never,
    tasks: { async getById() { return null; } } as never,
    createEmailActionToken: { async execute() { return 'unused'; } } as never,
    telegramDigestActions: { async attach() {} } as never,
    telegram: {
      async sendRichMessage(input: { html: string }) {
        sent += 1;
        html.push(input.html);
        return { kind: 'ok' as const, messageId: sent };
      },
      async sendMessage() {
        sent += 1;
        return { kind: 'ok' as const, messageId: sent };
      },
    } as never,
    appUrl: 'https://projectsflow.ru',
  });

  assert.equal(
    await service.execute({
      projectId: 'p1',
      dispatcherUserId: 'u1',
      commits: {},
      matches: [],
      reviews: [],
      overallSummary: 'За сегодня новых коммитов нет. Всё отлично.',
    }),
    false,
  );

  const sha = 'c'.repeat(40);
  assert.equal(
    await service.execute({
      projectId: 'p1',
      dispatcherUserId: 'u1',
      commits: {
        [sha]: {
          committedAt: '2026-07-17T10:00:00.000Z',
          message: 'safe change',
          htmlUrl: 'https://github.test/c',
          authorName: 'Developer',
          authorLogin: 'developer',
        },
      },
      matches: [],
      reviews: [{ commitSha: sha, verdict: 'good', summary: 'Всё хорошо.' }],
      overallSummary: 'Проверка пройдена.',
    }),
    true,
  );
  assert.equal(sent, 1);
  assert.match(html[0]!, /Все коммиты в порядке/);
  assert.doesNotMatch(html[0]!, /safe change|Всё хорошо/);
});
