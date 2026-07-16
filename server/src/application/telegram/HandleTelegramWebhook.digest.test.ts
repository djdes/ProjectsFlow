import assert from 'node:assert/strict';
import test from 'node:test';
import { HandleTelegramWebhook, type TelegramUpdate } from './HandleTelegramWebhook.js';

const taskId = '11111111-1111-4111-8111-111111111111';

function callback(data: string): TelegramUpdate {
  return {
    update_id: 1,
    callback_query: {
      id: `cq-${data}`,
      from: { id: 501, first_name: 'Ярослав' },
      data,
      message: {
        message_id: 77,
        chat: { id: -1007, type: 'supergroup' },
      },
    },
  };
}

test('digest panel expands, sorts and completes a task without opening a URL', async () => {
  let status = 'todo';
  const edits: any[] = [];
  const answers: any[] = [];
  const moves: any[] = [];
  const task = () => ({
    id: taskId,
    projectId: 'project-a',
    description: 'Проверить отчёт',
    status,
    position: 1,
    deadline: '2026-07-18',
    priority: 1,
    assignee: { userId: 'user-a', displayName: 'Ярослав', avatarUrl: null },
  });
  const handler = new HandleTelegramWebhook({
    users: {
      findUserIdByTelegramUserId: async () => 'user-a',
      getById: async () => ({ id: 'user-a', displayName: 'Ярослав' }),
    },
    members: { findForProject: async () => ({ role: 'editor' }) },
    projects: { getById: async () => ({ id: 'project-a', name: 'DocsFlow' }) },
    tasks: { getById: async () => task() },
    digestActions: {
      listByMessage: async () => [{
        token: 'a'.repeat(64),
        taskId,
        chatId: -1007,
        messageId: 77,
        messageHtml: '<h2>Сводка</h2><p>Задачи доступны в панели.</p>',
        messageKind: 'rich',
      }],
    },
    client: {
      editMessageText: async (input: any) => {
        edits.push(input);
      },
      answerCallbackQuery: async (id: string, options?: any) => {
        answers.push({ id, options });
      },
    },
    moveTask: {
      execute: async (input: any) => {
        moves.push(input);
        status = 'done';
      },
    },
    notifyTaskChanged() {},
    notifyStatusChanged() {},
    attachments: {},
    attachmentStorage: {},
    appUrl: 'https://projectsflow.ru',
    signingSecret: 'secret',
    botUsername: 'ProjectsFlow_Bot',
    ralphQuestionMessages: {},
    taskMessages: {},
    groupOwners: {},
    createComment: {},
    confirmCloseProposal: {},
    dismissCloseProposal: {},
    dispatchCommentNotifications: {},
    composer: {},
    maybeReopenForClarification: {},
    notifyCommentAdded() {},
  } as any);

  await handler.execute(callback('dgx:deadline'));
  const expanded = edits.at(-1)?.replyMarkup.inline_keyboard.flat();
  assert.ok(expanded.some((button: any) => button.callback_data === 'dgs:priority'));
  assert.ok(expanded.some((button: any) =>
    button.callback_data === `dgc:deadline:${taskId}` &&
    button.text === '○',
  ));
  assert.ok(expanded.some((button: any) =>
    button.url === `https://projectsflow.ru/projects/project-a?task=${taskId}` &&
    button.text.startsWith('Проверить отчёт'),
  ));

  await handler.execute(callback(`dgc:deadline:${taskId}`));

  assert.equal(moves.length, 1);
  assert.equal(moves[0].taskId, taskId);
  const completed = edits.at(-1)?.replyMarkup.inline_keyboard.flat();
  assert.ok(completed.some((button: any) =>
    button.callback_data === `dgc:deadline:${taskId}` &&
    button.text === '●' &&
    button.style === 'success',
  ));
  assert.ok(completed.some((button: any) =>
    button.url === `https://projectsflow.ru/projects/project-a?task=${taskId}` &&
    button.text.startsWith('✓ Проверить отчёт'),
  ));
  assert.ok(answers.some((answer) => answer.options?.text === '● Задача завершена'));
  assert.ok(!JSON.stringify(edits).includes('/api/telegram-digest-actions/'));
});
