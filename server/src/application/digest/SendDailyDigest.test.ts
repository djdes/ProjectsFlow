import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultDigestSettings } from '../../domain/digest/DigestSettings.js';
import type { Task } from '../../domain/task/Task.js';
import { SendDailyDigest } from './SendDailyDigest.js';

function openTask(): Task {
  return {
    id: 't1',
    projectId: 'p1',
    createdBy: 'u1',
    assignee: { userId: 'u1', displayName: 'Анна', avatarUrl: null },
    description: 'Проверить мобильную сводку',
    icon: null,
    cover: null,
    coverPosition: 50,
    status: 'todo',
    statusBeforeDone: null,
    position: 1,
    ralphMode: 'normal',
    ralphCancelRequestedAt: null,
    ralphCancelRequestedBy: null,
    ralphCancelRequestedByDisplayName: null,
    deadline: '2026-07-20',
    startDate: null,
    parentTaskId: null,
    priority: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
  };
}

test('manual group test deletes its predecessor and remembers one rich assignee digest', async () => {
  const settings = {
    ...defaultDigestSettings('p1'),
    telegramGroupChatId: -1007,
    telegramGroupTitle: 'Рабочая группа',
    daily: {
      ...defaultDigestSettings('p1').daily,
      enabled: true,
      recipientUserIds: ['u1'],
      channels: ['telegram'] as const,
      tgTargets: ['group', 'personal'] as const,
      tgGrouping: 'assignee' as const,
      statuses: ['todo'] as const,
    },
  };
  const deleted: Array<{ chatId: number; messageIds: readonly number[] }> = [];
  const saved: unknown[] = [];
  const actionDeliveries: unknown[] = [];
  const personalMessages: Array<{ kind: string; text: string }> = [];
  let richHtml = '';
  let richReplyMarkup: unknown = 'not-sent';

  const send = new SendDailyDigest({
    tasks: { listByProject: async () => [openTask()] } as never,
    comments: { countsByTasks: async () => new Map([['t1', 0]]) } as never,
    projects: {
      getById: async () => ({ id: 'p1', name: 'DocsFlow', isInbox: false }),
    } as never,
    members: {
      listByProject: async () => [
        {
          userId: 'u1',
          user: { id: 'u1', displayName: 'Анна', email: 'anna@example.test' },
        },
      ],
    } as never,
    users: {
      getTelegramLink: async () => ({
        telegramUserId: 101,
        telegramUsername: 'anna_pf',
      }),
    } as never,
    email: { send: async () => undefined } as never,
    notifications: { create: async () => undefined } as never,
    telegram: {
      execute: async (input: { kind: string; text: string }) => {
        personalMessages.push(input);
        return { status: 'not_connected' as const };
      },
    } as never,
    telegramClient: {
      sendMessage: async () => ({ kind: 'ok', messageId: 99 }),
      sendRichMessage: async (input: { html: string; replyMarkup?: unknown }) => {
        richHtml = input.html;
        richReplyMarkup = input.replyMarkup;
        return { kind: 'ok' as const, messageId: 44 };
      },
      deleteMessages: async (input: { chatId: number; messageIds: readonly number[] }) => {
        deleted.push(input);
      },
    } as never,
    settings: {
      getByProject: async () => settings,
      getLastTestDeliveries: async () => [{ chatId: -1007, messageIds: [11, 12] }],
      replaceLastTestDeliveries: async (_projectId: string, value: unknown) => {
        saved.push(value);
      },
    } as never,
    appUrl: 'https://projectsflow.ru',
    idGen: () => 'id',
    createEmailActionToken: { execute: async () => 'a'.repeat(64) } as never,
    telegramDigestActions: {
      attach: async (input: unknown) => {
        actionDeliveries.push(input);
      },
    } as never,
    signingSecret: 'secret',
  });

  const result = await send.execute('p1', { force: true });

  assert.deepEqual(result, { taskCount: 1 });
  assert.deepEqual(deleted, [{ chatId: -1007, messageIds: [11, 12] }]);
  assert.deepEqual(saved, [[], [{ chatId: -1007, messageIds: [44] }]]);
  assert.equal(actionDeliveries.length, 1);
  assert.deepEqual((actionDeliveries[0] as { tokens: string[] }).tokens, ['a'.repeat(64)]);
  assert.equal(richReplyMarkup, undefined);
  assert.ok(richHtml.includes('<details><summary>Показать задачи (1)</summary>'));
  assert.ok(richHtml.endsWith('</details>'));
  assert.ok(richHtml.includes('@anna_pf · Анна'));
  assert.ok(richHtml.includes('<table bordered striped>'));
  assert.ok(richHtml.includes('<th>Задача</th><th>Кто</th><th>Дедлайн</th>'));
  assert.ok(richHtml.includes('>✓</a>'));
  assert.ok(richHtml.includes('>↗</a>'));
  assert.ok(!richHtml.includes('Завершить') && !richHtml.includes('Перейти'));
  const personalTask = personalMessages.find((message) => message.kind === 'task_digest_item');
  assert.ok(personalTask);
  assert.match(personalTask.text, /^<blockquote expandable>/);
  assert.match(personalTask.text, /<b>Проверить мобильную сводку<\/b>/);
  assert.match(personalTask.text, />✓<\/a>/);
  assert.match(personalTask.text, />↗<\/a>/);
  assert.doesNotMatch(personalTask.text, /Завершить|Перейти|Открыть задачу|⏰/);
});
