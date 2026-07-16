import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractTelegramDigestActionTokens,
  markTelegramDigestTaskCompleted,
  TelegramDigestActionService,
} from './TelegramDigestActionService.js';

const token = 'a'.repeat(64);
const actionUrl = `https://projectsflow.ru/api/telegram-digest-actions/${token}`;
const richHtml =
  '<h2>Сводка</h2><details><summary>Показать</summary><ul>' +
  `<li><a href="${actionUrl}">○</a> ` +
  '<a href="https://projectsflow.ru/projects/p1?task=t1"><b>Проверить отчёт</b></a>' +
  '<br><i>⏰ осталось 2 дня</i></li></ul></details>';

test('rich digest completion fills the circle and strikes the task title', () => {
  const updated = markTelegramDigestTaskCompleted(richHtml, token);

  assert.match(updated, /<b>●<\/b>/);
  assert.match(
    updated,
    /<a href="https:\/\/projectsflow\.ru\/projects\/p1\?task=t1"><s><b>Проверить отчёт<\/b><\/s><\/a>/,
  );
  assert.doesNotMatch(updated, />○<\/a>/);
});

test('digest action tokens are extracted once from a message', () => {
  assert.deepEqual(
    extractTelegramDigestActionTokens(`${richHtml}${richHtml}`),
    [token],
  );
});

test('service completes the task and edits the same rich Telegram message', async () => {
  const edits: unknown[] = [];
  let storedHtml = richHtml;
  const service = new TelegramDigestActionService({
    emailActions: {
      preview: async () => ({
        kind: 'ok',
        action: 'complete',
        taskName: 'Проверить отчёт',
        alreadyUsed: false,
      }),
      complete: async () => ({ kind: 'done', projectId: 'p1', taskId: 't1' }),
    } as never,
    deliveries: {
      findByToken: async () => ({
        token,
        chatId: -1007,
        messageId: 42,
        messageHtml: storedHtml,
        messageKind: 'rich',
      }),
      updateMessage: async (input: { messageHtml: string }) => {
        storedHtml = input.messageHtml;
      },
    } as never,
    telegram: {
      editMessageText: async (input: unknown) => {
        edits.push(input);
      },
    } as never,
  });

  const result = await service.complete(token);

  assert.deepEqual(result, { kind: 'done', projectId: 'p1', taskId: 't1' });
  assert.match(storedHtml, /<b>●<\/b>/);
  assert.equal(edits.length, 1);
  assert.deepEqual(edits[0], {
    chatId: -1007,
    messageId: 42,
    richHtml: storedHtml,
  });
});
