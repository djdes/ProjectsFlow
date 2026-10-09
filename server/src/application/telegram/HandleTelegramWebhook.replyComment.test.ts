import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HandleTelegramWebhook, type TelegramUpdate } from './HandleTelegramWebhook.js';

// Reply на сообщение бота со списком задач (сводка, «На утверждении») → комментарий к задаче:
// по цитате названия, единственной задаче сообщения или выбору кнопкой.

const tasks = new Map([
  ['t1', { id: 't1', projectId: 'p1', description: '**Настроить печать заказов**\n\nС понедельника' }],
  ['t2', { id: 't2', projectId: 'p1', description: 'Настроить печать этикеток' }],
  ['t3', { id: 't3', projectId: 'p2', description: 'Опубликовать приложение WESETUP' }],
]);

function makeHarness(opts: { senderUserId?: string | null; listed?: string[] } = {}) {
  const sent: Array<{ chatId: number; text: string; replyMarkup?: any; replyToMessageId?: number }> = [];
  const edited: Array<{ chatId: number; messageId: number; text?: string; replyMarkup?: unknown }> = [];
  const answered: Array<{ id: string; text?: string }> = [];
  const comments: Array<{ projectId: string; taskId: string; ownerUserId: string; body: string }> = [];
  const listed = opts.listed ?? ['t1', 't2', 't3'];
  const senderUserId = 'senderUserId' in opts ? opts.senderUserId : 'u-sender';
  const deps = {
    users: {
      async findUserIdByTelegramUserId() {
        return senderUserId;
      },
    },
    members: {},
    tasks: {
      async getById(id: string) {
        return tasks.get(id) ?? null;
      },
    },
    client: {
      async sendMessage(i: any) {
        sent.push({ chatId: i.chatId, text: i.text, replyMarkup: i.replyMarkup, replyToMessageId: i.replyToMessageId });
        return { kind: 'ok' as const, messageId: 77 };
      },
      async editMessageText(i: any) {
        edited.push(i);
      },
      async answerCallbackQuery(id: string, o?: { text?: string }) {
        answered.push({ id, text: o?.text });
      },
    },
    appUrl: 'https://pf.test',
    botUsername: 'ProjectsFlow_Bot',
    ralphQuestionMessages: { async findByMessage() { return null; } },
    taskMessages: { async findByMessage() { return null; } },
    messageTasks: {
      async listByMessage(chatId: number, messageId: number) {
        return chatId === -100 && messageId === 9
          ? listed.map((taskId) => ({ taskId, projectId: tasks.get(taskId)?.projectId ?? 'p?' }))
          : [];
      },
      async attach() {},
    },
    createComment: {
      async execute(input: { projectId: string; taskId: string; ownerUserId: string; body: string }) {
        comments.push(input);
        return { id: `c${comments.length}`, replyToCommentId: null };
      },
    },
    dispatchCommentNotifications: { async execute() {} },
    groupOwners: { async getOwnerUserId() { return 'owner'; } },
    composer: { async startFromMessage() {}, async handleCallback() {} },
    maybeReopenForClarification: {},
    notifyTaskChanged() {},
    notifyCommentAdded() {},
    notifyStatusChanged() {},
  };
  return { h: new HandleTelegramWebhook(deps as any), sent, edited, answered, comments };
}

function replyUpdate(text: string, opts: { quote?: string; replyTo?: number; fromId?: number } = {}): TelegramUpdate {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      from: { id: opts.fromId ?? 111, first_name: 'Олег' },
      chat: { id: -100, type: 'supergroup', title: 'Рабочий чат' },
      text,
      reply_to_message: { message_id: opts.replyTo ?? 9, from: { id: 999, is_bot: true } },
      ...(opts.quote ? { quote: { text: opts.quote } } : {}),
    },
  };
}

function choiceUpdate(data: string, fromId = 111): TelegramUpdate {
  return {
    update_id: 2,
    callback_query: {
      id: 'cq1',
      from: { id: fromId },
      message: { message_id: 77, chat: { id: -100 } },
      data,
    },
  } as TelegramUpdate;
}

test('reply с цитатой названия — комментарий к этой задаче, ответ привязан к реплике', async () => {
  const h = makeHarness();
  await h.h.execute(replyUpdate('Сделал, проверьте', { quote: 'Опубликовать приложение WESETUP' }));
  assert.deepEqual(
    h.comments.map((c) => [c.taskId, c.projectId, c.ownerUserId, c.body]),
    [['t3', 'p2', 'u-sender', 'Сделал, проверьте']],
  );
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0]!.text, /Комментарий добавлен к «Опубликовать приложение WESETUP»/);
  assert.equal(h.sent[0]!.replyToMessageId, 10);
});

test('reply без цитаты на сообщение с одной задачей — комментарий к ней', async () => {
  const h = makeHarness({ listed: ['t1'] });
  await h.h.execute(replyUpdate('Принтер подключён'));
  assert.deepEqual(h.comments.map((c) => c.taskId), ['t1']);
  assert.match(h.sent[0]!.text, /Настроить печать заказов/);
});

test('reply без цитаты на сводку — выбор задачи кнопками, комментарий после нажатия автора', async () => {
  const h = makeHarness();
  await h.h.execute(replyUpdate('Нужна помощь'));
  assert.equal(h.comments.length, 0);
  const prompt = h.sent[0]!;
  assert.match(prompt.text, /К какой задаче добавить комментарий/);
  const buttons = prompt.replyMarkup.inline_keyboard.flat();
  assert.deepEqual(
    buttons.map((b: any) => b.text),
    ['Настроить печать заказов', 'Настроить печать этикеток', 'Опубликовать приложение WESETUP', 'Не добавлять'],
  );

  // Чужой человек нажать за автора не может.
  await h.h.execute(choiceUpdate(buttons[1].callback_data, 222));
  assert.equal(h.comments.length, 0);
  assert.match(h.answered.at(-1)!.text ?? '', /выбирает автор/);

  await h.h.execute(choiceUpdate(buttons[1].callback_data));
  assert.deepEqual(h.comments.map((c) => [c.taskId, c.body]), [['t2', 'Нужна помощь']]);
  assert.match(h.edited.at(-1)!.text ?? '', /Комментарий добавлен к «Настроить печать этикеток»/);

  // Повторное нажатие не создаёт второй комментарий.
  await h.h.execute(choiceUpdate(buttons[1].callback_data));
  assert.equal(h.comments.length, 1);
  assert.match(h.edited.at(-1)!.text ?? '', /Время на выбор вышло/);
});

test('цитата подходит к нескольким задачам — кнопки только для совпавших', async () => {
  const h = makeHarness();
  await h.h.execute(replyUpdate('Обе сделал', { quote: 'Настроить печать' }));
  const buttons = h.sent[0]!.replyMarkup.inline_keyboard.flat();
  assert.deepEqual(
    buttons.map((b: any) => b.text),
    ['Настроить печать заказов', 'Настроить печать этикеток', 'Не добавлять'],
  );
});

test('«Не добавлять» снимает выбор без комментария', async () => {
  const h = makeHarness();
  await h.h.execute(replyUpdate('Черновик'));
  const cancel = h.sent[0]!.replyMarkup.inline_keyboard.flat().at(-1);
  await h.h.execute(choiceUpdate(cancel.callback_data));
  assert.equal(h.comments.length, 0);
  assert.match(h.edited.at(-1)!.text ?? '', /не добавлен/);
});

test('reply от непривязанного Telegram — просьба привязать, без комментария', async () => {
  const h = makeHarness({ senderUserId: null });
  await h.h.execute(replyUpdate('Сделал', { quote: 'Опубликовать приложение WESETUP' }));
  assert.equal(h.comments.length, 0);
  assert.match(h.sent[0]!.text, /привяжи Telegram/);
});

test('reply на сообщение без задач — подсказка', async () => {
  const h = makeHarness();
  await h.h.execute(replyUpdate('Что это?', { replyTo: 55 }));
  assert.equal(h.comments.length, 0);
  assert.match(h.sent[0]!.text, /не привязано к задаче/);
});
