import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultWorkspaceAssigneeDigestSettings } from '../../domain/digest/WorkspaceAssigneeDigestSettings.js';
import { SendWorkspaceEodReminder } from './SendWorkspaceEodReminder.js';

test('workspace EOD reminder sends one compact group table for selected projects', async () => {
  const rich: Array<{ chatId: number; html: string; replyMarkup: any }> = [];
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
          ? [{ status: 'todo' }, { status: 'done' }]
          : [{ status: 'todo' }];
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
  assert.match(rich[0]!.html, /<table/);
  assert.match(rich[0]!.html, /DocsFlow/);
  assert.doesNotMatch(rich[0]!.html, /Banana/);
  assert.equal(
    rich[0]!.replyMarkup.inline_keyboard[0][0].url,
    'https://projectsflow.ru/projects/p1',
  );
});
