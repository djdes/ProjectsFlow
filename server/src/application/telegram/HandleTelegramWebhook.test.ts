import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HandleTelegramWebhook, type TelegramUpdate } from './HandleTelegramWebhook.js';

// Фокусный тест: гейт групповых чатов (бот реагирует только на обращение к нему).
// Минимальные in-memory стабы (tsx + node:test).
function makeHarness() {
  const composerCalls: { tgUserId: number; chatId: number; text: string }[] = [];
  const sent: { chatId: number; text: string }[] = [];
  let ralphLookups = 0;
  let taskLookups = 0;

  const deps = {
    users: { async findUserIdByTelegramUserId() { return null; } },
    members: {},
    tasks: {},
    client: {
      async sendMessage(i: any) { sent.push({ chatId: i.chatId, text: i.text }); return { kind: 'ok' as const, messageId: 1 }; },
      async answerCallbackQuery() {},
    },
    appUrl: 'https://pf.test',
    botUsername: 'ProjectsFlow_Bot',
    ralphQuestionMessages: { async findByMessage() { ralphLookups += 1; return null; } },
    taskMessages: { async findByMessage() { taskLookups += 1; return null; } },
    createComment: {},
    dispatchCommentNotifications: {},
    composer: {
      async startFromMessage(tgUserId: number, chatId: number, text: string) {
        composerCalls.push({ tgUserId, chatId, text });
      },
      async handleCallback() {},
      async handleInlineQuery() {},
    },
    maybeReopenForClarification: {},
    notifyTaskChanged() {},
    notifyCommentAdded() {},
    notifyStatusChanged() {},
  };

  const h = new HandleTelegramWebhook(deps as any);
  return {
    h,
    composerCalls,
    sent,
    ralphLookups: () => ralphLookups,
    taskLookups: () => taskLookups,
  };
}

function msgUpdate(opts: {
  text: string;
  chatType: string;
  reply?: { is_bot: boolean };
}): TelegramUpdate {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      from: { id: 111, first_name: 'U' },
      chat: { id: 500, type: opts.chatType },
      text: opts.text,
      ...(opts.reply
        ? { reply_to_message: { message_id: 9, from: { id: 999, is_bot: opts.reply.is_bot } } }
        : {}),
    },
  };
}

test('группа: обычное сообщение без упоминания → игнор', async () => {
  const h = makeHarness();
  await h.h.execute(msgUpdate({ text: 'просто болтаем в чате', chatType: 'supergroup' }));
  assert.equal(h.composerCalls.length, 0);
  assert.equal(h.sent.length, 0);
  assert.equal(h.ralphLookups(), 0);
});

test('группа: @упоминание + текст → задача из очищенного текста', async () => {
  const h = makeHarness();
  await h.h.execute(msgUpdate({ text: '@ProjectsFlow_Bot купить домен', chatType: 'group' }));
  assert.equal(h.composerCalls.length, 1);
  assert.equal(h.composerCalls[0]!.text, 'купить домен'); // упоминание вырезано
});

test('группа: @упоминание регистронезависимо, упоминание в середине', async () => {
  const h = makeHarness();
  await h.h.execute(msgUpdate({ text: 'эй @projectsflow_bot сделай отчёт', chatType: 'supergroup' }));
  assert.equal(h.composerCalls.length, 1);
  assert.equal(h.composerCalls[0]!.text, 'эй сделай отчёт');
});

test('группа: /help@BotName → справка (не задача)', async () => {
  const h = makeHarness();
  await h.h.execute(msgUpdate({ text: '/help@ProjectsFlow_Bot', chatType: 'group' }));
  assert.equal(h.composerCalls.length, 0);
  assert.ok(h.sent.length >= 1);
  assert.ok(h.sent[0]!.text.includes('ProjectsFlow'));
});

test('группа: reply на сообщение бота → reply-ветка (не игнор)', async () => {
  const h = makeHarness();
  await h.h.execute(msgUpdate({ text: 'мой ответ', chatType: 'group', reply: { is_bot: true } }));
  assert.equal(h.composerCalls.length, 0);
  assert.equal(h.ralphLookups(), 1); // дошли до handleReply
});

test('группа: reply на НЕ бота без упоминания → игнор', async () => {
  const h = makeHarness();
  await h.h.execute(msgUpdate({ text: 'ответ другому юзеру', chatType: 'group', reply: { is_bot: false } }));
  assert.equal(h.composerCalls.length, 0);
  assert.equal(h.ralphLookups(), 0);
  assert.equal(h.sent.length, 0);
});

test('личка: любой текст → задача (без изменений)', async () => {
  const h = makeHarness();
  await h.h.execute(msgUpdate({ text: 'купить кофе', chatType: 'private' }));
  assert.equal(h.composerCalls.length, 1);
  assert.equal(h.composerCalls[0]!.text, 'купить кофе');
});

test('личка: упоминание НЕ вырезается (там оно не требуется)', async () => {
  const h = makeHarness();
  await h.h.execute(msgUpdate({ text: 'позови @ProjectsFlow_Bot', chatType: 'private' }));
  assert.equal(h.composerCalls.length, 1);
  assert.equal(h.composerCalls[0]!.text, 'позови @ProjectsFlow_Bot');
});
