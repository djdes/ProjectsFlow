import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultWorkspaceAssigneeDigestSettings } from '../../domain/digest/WorkspaceAssigneeDigestSettings.js';
import { SendWorkspaceEodReminder } from './SendWorkspaceEodReminder.js';

test('workspace EOD reminder includes due work from every project and every actual assignee', async () => {
  const rich: Array<{ chatId: number; html: string; replyMarkup?: unknown }> = [];
  const attached: Array<{ tokens: string[]; messageId: number }> = [];
  const token = 'a'.repeat(32);
  const send = new SendWorkspaceEodReminder({
    settings: {
      async get() {
        return {
          ...defaultWorkspaceAssigneeDigestSettings('w1'),
          telegramGroupChatId: -1007,
          projectMode: 'selected' as const,
          projectIds: ['p1'],
          eodReminderEnabled: true,
        };
      },
    } as never,
    workspaces: {
      async listMembers() {
        return [
          { workspaceId: 'w1', userId: 'u1', role: 'editor', displayName: 'Анна' },
          { workspaceId: 'w1', userId: 'u2', role: 'editor', displayName: 'Борис' },
        ];
      },
    } as never,
    projects: {
      async listByWorkspace() {
        return [
          { id: 'p1', name: 'DocsFlow', icon: null },
          { id: 'p2', name: 'Banana', icon: null },
        ];
      },
      async listAllByWorkspace() {
        return [
          { id: 'p1', name: 'DocsFlow', icon: null },
          { id: 'p2', name: 'Banana', icon: null },
          { id: 'inbox-u3', name: 'Входящие', icon: null },
        ];
      },
    } as never,
    tasks: {
      async listByProject(projectId: string) {
        if (projectId === 'inbox-u3') {
          return [
            {
              id: 't6',
              projectId: 'inbox-u3',
              status: 'backlog',
              description: 'Задача из личных входящих',
              deadline: '2000-01-03',
              assignee: { userId: 'u3', displayName: 'Мистер Линукс' },
            },
          ];
        }
        return projectId === 'p1'
          ? [
              {
                id: 't1',
                projectId: 'p1',
                status: 'backlog',
                description: 'Проверить документы',
                deadline: '2000-01-01',
                assignee: { userId: 'u1', displayName: 'Анна' },
              },
              {
                id: 't2',
                projectId: 'p1',
                status: 'done',
                description: 'Готово',
                deadline: '2000-01-01',
                assignee: { userId: 'u2', displayName: 'Борис' },
              },
            ]
          : [
              {
                id: 't3',
                projectId: 'p2',
                status: 'manual',
                description: 'Исправить сервер',
                deadline: '2000-01-02',
                assignee: { userId: 'u3', displayName: 'Мистер Линукс' },
              },
              {
                id: 't4',
                projectId: 'p2',
                status: 'todo',
                description: 'Задача без дедлайна',
                deadline: null,
                assignee: { userId: 'u3', displayName: 'Мистер Линукс' },
              },
              {
                id: 't5',
                projectId: 'p2',
                status: 'todo',
                description: 'Будущая задача',
                deadline: '2999-01-01',
                assignee: { userId: 'u1', displayName: 'Анна' },
              },
            ];
      },
    } as never,
    users: {
      async getTelegramLink(userId: string) {
        return {
          userId,
          telegramUserId: userId === 'u1' ? 101 : userId === 'u2' ? 102 : 103,
          telegramUsername:
            userId === 'u1' ? 'anna_pf' : userId === 'u2' ? 'boris_pf' : 'mrlinux_pf',
        };
      },
    } as never,
    createEmailActionToken: {
      async execute() {
        return token;
      },
    } as never,
    telegramDigestActions: {
      async attach(input: { tokens: string[]; messageId: number }) {
        attached.push(input);
      },
    } as never,
    telegram: {
      async sendRichMessage(input: any) {
        rich.push(input);
        return { kind: 'ok' as const, messageId: 7 };
      },
      async sendMessage() {
        throw new Error('fallback must not be used');
      },
    } as never,
    appUrl: 'https://projectsflow.ru',
  });

  assert.deepEqual(await send.execute('w1'), { projectCount: 3, taskCount: 3 });
  assert.equal(rich.length, 1);
  assert.equal(rich[0]!.chatId, -1007);
  assert.match(rich[0]!.html, /<details><summary>Показать по ответственным \(3\)<\/summary>/);
  assert.match(rich[0]!.html, /@anna_pf — проверить и доделать \(1\)/);
  assert.match(rich[0]!.html, /@boris_pf — молодец, всё сделано/);
  assert.match(rich[0]!.html, /@mrlinux_pf — проверить и доделать \(2\)/);
  assert.match(rich[0]!.html, /Проверить документы/);
  assert.match(rich[0]!.html, /Исправить сервер/);
  assert.match(rich[0]!.html, /Задача из личных входящих/);
  assert.match(rich[0]!.html, /Входящие/);
  assert.match(rich[0]!.html, /Banana/);
  assert.doesNotMatch(rich[0]!.html, /Задача без дедлайна|Будущая задача|Готово/);
  assert.match(rich[0]!.html, new RegExp(`/api/telegram-digest-actions/${token}`));
  assert.match(rich[0]!.html, />✓<\/a> · <a [^>]+>↗<\/a>/);
  assert.equal(rich[0]!.replyMarkup, undefined);
  assert.equal(attached.length, 1);
  assert.deepEqual(attached[0]!.tokens, [token]);
  assert.equal(attached[0]!.messageId, 7);
});
