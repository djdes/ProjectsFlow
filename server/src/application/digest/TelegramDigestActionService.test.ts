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
  '<h2>Сводка</h2><details><summary>Показать</summary><table bordered striped>' +
  '<tr><th>Задача</th><th>Кто</th><th>Дедлайн</th></tr>' +
  '<tr><td><b>Проверить отчёт</b>' +
  `<br><a href="${actionUrl}">✓</a> · ` +
  '<a href="https://projectsflow.ru/projects/p1?task=t1">↗</a></td>' +
  '<td>Анна</td><td>осталось 2 дня</td></tr></table></details>';

test('rich digest completion replaces the action and strikes the task title', () => {
  const updated = markTelegramDigestTaskCompleted(richHtml, token);

  assert.match(updated, /<b>✅<\/b>/);
  assert.match(updated, /<s><b>Проверить отчёт<\/b><\/s>/);
  assert.doesNotMatch(updated, />✓<\/a>/);
  assert.match(updated, />↗<\/a>/);
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
  assert.match(storedHtml, /<b>✅<\/b>/);
  assert.equal(edits.length, 1);
  assert.deepEqual(edits[0], {
    chatId: -1007,
    messageId: 42,
    richHtml: storedHtml,
  });
});

test('approval submission in a rich digest keeps the title and shows its pending state', () => {
  const updated = markTelegramDigestTaskCompleted(richHtml, token, 'pending_approval');
  assert.match(updated, /📨 На утверждении/);
  assert.doesNotMatch(updated, /<s>|✅/);
  assert.match(updated, /<b>Проверить отчёт<\/b>/);
  assert.match(updated, />↗<\/a>/);
});

test('approval submission in a fallback digest does not strike or finish the task', () => {
  const fallback = `<li><a href="https://pf.test/task"><b>Проверить отчёт</b></a> <a href="${actionUrl}">✓ Завершить</a></li>`;
  const updated = markTelegramDigestTaskCompleted(fallback, token, 'pending_approval');
  assert.match(updated, /📨 На утверждении/);
  assert.doesNotMatch(updated, /<s>|Завершено/);
});

test('pending and repeated pending results update Telegram without marking the task done', async () => {
  for (const result of [{kind: 'pending_approval', projectId: 'p1', taskId: 't1'}, {kind: 'used', taskStatus: 'pending_approval'}]) {
    let edited = '';
    const service = new TelegramDigestActionService({
      emailActions: {complete: async () => result} as never,
      deliveries: {findByToken: async () => ({chatId: 1, messageId: 1, messageKind: 'rich', messageHtml: richHtml}), updateMessage: async () => {}} as never,
      telegram: {editMessageText: async (input: {richHtml: string}) => {edited = input.richHtml;}} as never,
    });
    await service.complete(token);
    assert.match(edited, /На утверждении/);
    assert.doesNotMatch(edited, /<s>|✅/);
  }
});