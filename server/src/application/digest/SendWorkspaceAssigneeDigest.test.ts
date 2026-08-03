import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultWorkspaceAssigneeDigestSettings } from '../../domain/digest/WorkspaceAssigneeDigestSettings.js';
import {
  SendWorkspaceAssigneeDigest,
  buildWorkspaceAssigneeDigestMessage,
  buildWorkspaceAssigneeDigestRichMessage,
} from './SendWorkspaceAssigneeDigest.js';
import type { Task } from '../../domain/task/Task.js';
import type { TelegramLink } from '../../domain/telegram/TelegramLink.js';

function task(id: string, projectId: string, description: string, deadline: string | null): Task {
  return {
    id,
    projectId,
    createdBy: '11111111-1111-4111-8111-111111111111',
    creator: null,
    assignee: {
      userId: '22222222-2222-4222-8222-222222222222',
      displayName: 'Денис',
      avatarUrl: null,
    },
    description,
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
    deadline,
    startDate: null,
    parentTaskId: null,
    priority: null,
    createdAt: new Date('2026-07-10T00:00:00.000Z'),
    updatedAt: new Date('2026-07-10T00:00:00.000Z'),
  };
}

const link: TelegramLink = {
  telegramUserId: 123,
  telegramUsername: 'denis_pf',
  telegramFirstName: 'Денис',
  telegramPhotoUrl: null,
  telegramAuthDate: null,
  tgChatId: 123,
  tgStartedAt: new Date(),
  tgPairedAt: new Date(),
  prefs: null,
};

test('workspace assignee digest renders one compact message with mention and project groups', () => {
  const message = buildWorkspaceAssigneeDigestMessage({
    displayName: 'Денис',
    telegramLink: link,
    appUrl: 'https://projectsflow.ru',
    now: new Date('2026-07-16T09:00:00.000Z'),
    projects: [
      {
        project: { id: 'project-a', name: 'DocsFlow' },
        tasks: [task('task-a', 'project-a', 'Проверить документы\nПодробности', '2026-07-18')],
      },
      {
        project: { id: 'project-b', name: 'Banana' },
        tasks: [task('task-b', 'project-b', 'Собрать релиз', null)],
      },
    ],
  });

  assert.match(message, /Ежедневные задачи для @denis_pf/);
  assert.match(message, /Открытых задач: <b>2<\/b>/);
  assert.match(message, /<blockquote expandable>/);
  assert.match(message, /DocsFlow/);
  assert.match(message, /Banana/);
  assert.match(message, /projects\/project-a\?task=task-a/);
  assert.match(message, />✓<\/a>/);
  assert.match(message, />↗<\/a>/);
  assert.doesNotMatch(message, /Завершить|Перейти|Подробности|осталось 2 дня/);
  assert.ok(message.length <= 3800);
});

test('workspace assignee digest uses the same rich layout as regular Telegram digests', () => {
  const message = buildWorkspaceAssigneeDigestRichMessage({
    displayName: 'Денис',
    telegramLink: link,
    appUrl: 'https://projectsflow.ru',
    now: new Date('2026-07-16T09:00:00.000Z'),
    completeActionLinks: new Map([
      ['task-a', 'https://projectsflow.ru/api/telegram-digest-actions/' + 'a'.repeat(64)],
      ['task-b', 'https://projectsflow.ru/api/telegram-digest-actions/' + 'b'.repeat(64)],
    ]),
    projects: [
      {
        project: { id: 'project-a', name: 'DocsFlow' },
        tasks: [task('task-a', 'project-a', 'Проверить документы\nПодробности', '2026-07-18')],
      },
      {
        project: { id: 'project-b', name: 'Banana' },
        tasks: [task('task-b', 'project-b', 'Собрать релиз', null)],
      },
    ],
  });

  assert.match(message, /^<h2>🗒 Ежедневные задачи для @denis_pf<\/h2>/);
  assert.match(message, /<p>Открытых задач: <b>2<\/b><\/p>/);
  assert.match(message, /<details><summary>Показать задачи \(2\)<\/summary>/);
  assert.match(message, /<\/details>$/);
  assert.match(message, /<h3>📁 DocsFlow<\/h3>/);
  assert.match(message, /<h3>📁 Banana<\/h3>/);
  assert.match(message, /<table bordered striped>/);
  assert.match(message, /<th>Задача<\/th><th>Кто<\/th><th>Дедлайн<\/th>/);
  assert.doesNotMatch(message, /<a href="https:\/\/projectsflow\.ru\/projects\/project-a\?task=task-a"><b>/);
  assert.match(message, /telegram-digest-actions/);
  assert.match(message, />✓<\/a>/);
  assert.match(message, />↗<\/a>/);
  assert.doesNotMatch(message, /Завершить|Перейти|Подробности/);
  assert.match(message, />осталось 2 дня<\/td>/);
  assert.match(message, /<td>Денис<\/td>/);
});

test('workspace assignee digest renders delegated projectless tasks as their own column', () => {
  const message = buildWorkspaceAssigneeDigestRichMessage({
    displayName: 'Денис',
    telegramLink: link,
    appUrl: 'https://projectsflow.ru',
    now: new Date('2026-07-16T09:00:00.000Z'),
    projects: [
      {
        project: { id: 'project-a', name: 'DocsFlow' },
        tasks: [task('task-a', 'project-a', 'Проверить документы', null)],
      },
      {
        project: { id: 'inbox-denis', name: 'Делегированные' },
        isInbox: true,
        tasks: [task('task-c', 'inbox-denis', 'Позвонить подрядчику', null)],
      },
    ],
  });

  assert.match(message, /<h3>📁 DocsFlow<\/h3>/);
  assert.match(message, /<h3>🤝 Делегированные<\/h3>/);
  assert.match(message, /<p>Открытых задач: <b>2<\/b><\/p>/);
  // Задача без проекта открывается во «Входящих», а не по /projects/<inbox-id>.
  assert.match(message, /https:\/\/projectsflow\.ru\/inbox\?task=task-c/);
  assert.doesNotMatch(message, /projects\/inbox-denis/);
});

test('workspace assignee digest adds a delegated column from personal inboxes', async () => {
  const rich: Array<{ chatId: number; html: string }> = [];
  const inboxTask = (
    id: string,
    description: string,
    createdBy: string | null,
    assigneeUserId: string,
    status = 'todo',
  ): unknown => ({
    ...task(id, 'inbox-u1', description, null),
    createdBy,
    status,
    assignee: { userId: assigneeUserId, displayName: 'Анна', avatarUrl: null },
  });
  const send = new SendWorkspaceAssigneeDigest({
    settings: {
      async get() {
        return {
          ...defaultWorkspaceAssigneeDigestSettings('w1'),
          enabled: true,
          telegramGroupChatId: -1007,
        };
      },
      async replaceLastTestDeliveries() {},
      async getLastTestDeliveries() {
        return [];
      },
    } as never,
    workspaces: {
      async listMembers() {
        return [{ workspaceId: 'w1', userId: 'u1', role: 'editor', displayName: 'Анна' }];
      },
    } as never,
    projects: {
      async listByWorkspace() {
        return [];
      },
      async listInboxesByOwners() {
        return [{ id: 'inbox-u1', name: 'Входящие', ownerId: 'u1', isInbox: true }];
      },
    } as never,
    tasks: {
      async listByProject(projectId: string) {
        return projectId === 'inbox-u1'
          ? [
              inboxTask('t1', 'Позвонить подрядчику', 'u2', 'u1'),
              // Своя личная заметка — не делегирование, в общий чат не выносим.
              inboxTask('t2', 'Купить кофе', 'u1', 'u1'),
              // Выполненная делегированная — в сводке открытых задач ей не место.
              inboxTask('t3', 'Старое поручение', 'u2', 'u1', 'done'),
            ]
          : [];
      },
    } as never,
    users: {
      async getTelegramLink() {
        return { telegramUserId: 101, telegramUsername: 'anna_pf' };
      },
    } as never,
    createEmailActionToken: {
      async execute() {
        return 'c'.repeat(64);
      },
    } as never,
    telegramDigestActions: {
      async attach() {},
    } as never,
    telegram: {
      async sendRichMessage(input: { chatId: number; html: string }) {
        rich.push(input);
        return { kind: 'ok' as const, messageId: 7 };
      },
      async sendMessage() {
        throw new Error('fallback must not be used');
      },
    } as never,
    appUrl: 'https://projectsflow.ru',
  });

  const result = await send.execute('w1');

  assert.equal(result.taskCount, 1);
  assert.equal(result.sentCount, 1);
  assert.equal(rich.length, 1);
  assert.match(rich[0]!.html, /<h3>🤝 Делегированные<\/h3>/);
  assert.match(rich[0]!.html, /Позвонить подрядчику/);
  assert.doesNotMatch(rich[0]!.html, /Купить кофе|Старое поручение/);
});
