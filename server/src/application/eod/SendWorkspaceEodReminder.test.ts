import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultWorkspaceAssigneeDigestSettings } from '../../domain/digest/WorkspaceAssigneeDigestSettings.js';
import { SendWorkspaceEodReminder } from './SendWorkspaceEodReminder.js';

test('workspace EOD reminder groups every member and keeps actions inside the rich table', async () => {
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
    } as never,
    tasks: {
      async listByProject(projectId: string) {
        return projectId === 'p1'
          ? [
              {
                id: 't1',
                projectId: 'p1',
                status: 'todo',
                description: 'Проверить документы',
                deadline: null,
                assignee: { userId: 'u1', displayName: 'Анна' },
              },
              {
                id: 't2',
                projectId: 'p1',
                status: 'done',
                description: 'Готово',
                deadline: null,
                assignee: { userId: 'u2', displayName: 'Борис' },
              },
            ]
          : [];
      },
    } as never,
    users: {
      async getTelegramLink(userId: string) {
        return {
          userId,
          telegramUserId: userId === 'u1' ? 101 : 102,
          telegramUsername: userId === 'u1' ? 'anna_pf' : 'boris_pf',
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

  assert.deepEqual(await send.execute('w1'), { projectCount: 1, taskCount: 1 });
  assert.equal(rich.length, 1);
  assert.equal(rich[0]!.chatId, -1007);
  assert.match(rich[0]!.html, /<details><summary>Показать по ответственным \(2\)<\/summary>/);
  assert.match(rich[0]!.html, /@anna_pf — проверить и доделать \(1\)/);
  assert.match(rich[0]!.html, /@boris_pf — молодец, всё сделано/);
  assert.match(rich[0]!.html, /Проверить документы/);
  assert.match(rich[0]!.html, new RegExp(`/api/telegram-digest-actions/${token}`));
  assert.match(rich[0]!.html, />✓<\/a> · <a [^>]+>↗<\/a>/);
  assert.doesNotMatch(rich[0]!.html, /Banana/);
  assert.equal(rich[0]!.replyMarkup, undefined);
  assert.equal(attached.length, 1);
  assert.deepEqual(attached[0]!.tokens, [token]);
  assert.equal(attached[0]!.messageId, 7);
});
