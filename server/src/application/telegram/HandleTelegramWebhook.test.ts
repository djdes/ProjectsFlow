import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HandleTelegramWebhook, type TelegramUpdate } from './HandleTelegramWebhook.js';

// Фокусный тест: гейт групповых чатов (бот реагирует только на обращение к нему).
// Минимальные in-memory стабы (tsx + node:test).
function makeHarness(opts?: { senderUserId?: string | null; boundOwner?: string | null }) {
  const composerCalls: { tgUserId: number; chatId: number; text: string; groupCtx: any }[] = [];
  const sent: { chatId: number; text: string }[] = [];
  const bindCalls: { tgChatId: number; ownerUserId: string }[] = [];
  const startedCalls: { userId: string; chatId: number }[] = [];
  let ralphLookups = 0;
  let taskLookups = 0;
  const senderUserId = opts && 'senderUserId' in opts ? (opts.senderUserId ?? null) : null;
  let boundOwner: string | null = opts?.boundOwner ?? null;

  const deps = {
    users: {
      async findUserIdByTelegramUserId() { return senderUserId; },
      async getById(uid: string) { return { id: uid, displayName: 'Владелец' }; },
      async markTelegramStarted(userId: string, chatId: number) { startedCalls.push({ userId, chatId }); },
    },
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
    groupOwners: {
      async getOwnerUserId() { return boundOwner; },
      async bindIfAbsent(tgChatId: number, ownerUserId: string) {
        bindCalls.push({ tgChatId, ownerUserId });
        if (boundOwner) return { ownerUserId: boundOwner, created: false };
        boundOwner = ownerUserId;
        return { ownerUserId, created: true };
      },
    },
    composer: {
      async startFromMessage(tgUserId: number, chatId: number, text: string, groupCtx?: any) {
        composerCalls.push({ tgUserId, chatId, text, groupCtx });
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
    bindCalls,
    startedCalls,
    ralphLookups: () => ralphLookups,
    taskLookups: () => taskLookups,
  };
}

function msgUpdate(opts: {
  text: string;
  chatType: string;
  reply?: { is_bot: boolean };
  from?: { id?: number; first_name?: string; last_name?: string; username?: string };
  chatTitle?: string;
}): TelegramUpdate {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      from: { id: 111, first_name: 'U', ...opts.from },
      chat: { id: 500, type: opts.chatType, ...(opts.chatTitle ? { title: opts.chatTitle } : {}) },
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

// --- Группа: привязка владельца (/start) + проброс groupCtx в композер ---

test('группа: /start от привязанного → bindIfAbsent, DM-чат НЕ трогаем', async () => {
  const h = makeHarness({ senderUserId: 'owner1' });
  await h.h.execute(msgUpdate({ text: '/start@ProjectsFlow_Bot', chatType: 'supergroup' }));
  assert.equal(h.bindCalls.length, 1);
  assert.equal(h.bindCalls[0]!.ownerUserId, 'owner1');
  assert.equal(h.startedCalls.length, 0); // markTelegramStarted НЕ вызван в группе
  assert.equal(h.composerCalls.length, 0);
  assert.ok(h.sent.length >= 1);
});

test('группа: /start от НЕпривязанного → просьба привязать, без bind', async () => {
  const h = makeHarness({ senderUserId: null });
  await h.h.execute(msgUpdate({ text: '/start@ProjectsFlow_Bot', chatType: 'group' }));
  assert.equal(h.bindCalls.length, 0);
  assert.ok(h.sent[0]!.text.toLowerCase().includes('привяж'));
});

test('группа: текст задачи → композер получает groupCtx (owner + имя + title)', async () => {
  const h = makeHarness({ boundOwner: 'owner1' });
  await h.h.execute(
    msgUpdate({
      text: '@ProjectsFlow_Bot купить домен',
      chatType: 'group',
      from: { first_name: 'Олег', last_name: 'МрLinux', username: 'oleg' },
      chatTitle: 'Рабочий чат',
    }),
  );
  assert.equal(h.composerCalls.length, 1);
  const ctx = h.composerCalls[0]!.groupCtx;
  assert.ok(ctx, 'groupCtx передан');
  assert.equal(ctx.ownerUserId, 'owner1');
  assert.equal(ctx.groupTitle, 'Рабочий чат');
  assert.ok(ctx.senderName.includes('Олег'));
  assert.ok(ctx.senderName.includes('oleg')); // @username в подписи
});

test('личка: композер БЕЗ groupCtx (undefined)', async () => {
  const h = makeHarness();
  await h.h.execute(msgUpdate({ text: 'купить кофе', chatType: 'private' }));
  assert.equal(h.composerCalls.length, 1);
  assert.equal(h.composerCalls[0]!.groupCtx, undefined);
});

// --- Инлайн-действия задачных уведомлений (nd/nc/nu) ---

function makeCbHarness(opts?: { userId?: string | null; task?: any }) {
  const answers: { id: string; text?: string; showAlert?: boolean }[] = [];
  const edits: { text: string; replyMarkup: any }[] = [];
  const sent: { chatId: number; text: string; replyMarkup: any }[] = [];
  const moves: any[] = [];
  const upserts: any[] = [];
  const statusNotifs: string[] = [];
  const composerCallbacks: string[] = [];
  const userId = opts && 'userId' in opts ? opts.userId! : 'u1';
  const task =
    opts?.task !== undefined
      ? opts.task
      : { id: 't1', projectId: 'p1', status: 'todo', statusBeforeDone: null, description: 'починить парсер' };

  const deps = {
    users: {
      async findUserIdByTelegramUserId() { return userId; },
      async getById() { return { id: 'u1', displayName: 'Ярослав' }; },
    },
    members: { async findForProject() { return userId ? { role: 'editor' } : null; } },
    tasks: { async getById() { return task; } },
    client: {
      async sendMessage(i: any) { sent.push({ chatId: i.chatId, text: i.text, replyMarkup: i.replyMarkup }); return { kind: 'ok' as const, messageId: 77 }; },
      async answerCallbackQuery(id: string, o?: any) { answers.push({ id, ...(o ?? {}) }); },
      async editMessageText(i: any) { edits.push({ text: i.text, replyMarkup: i.replyMarkup }); },
    },
    appUrl: 'https://pf.test',
    botUsername: 'ProjectsFlow_Bot',
    ralphQuestionMessages: { async findByMessage() { return null; }, async upsert() {} },
    taskMessages: { async findByMessage() { return null; }, async upsert(i: any) { upserts.push(i); } },
    createComment: {},
    moveTask: { async execute(i: any) { moves.push(i); return { ...task, status: i.targetStatus }; } },
    dispatchCommentNotifications: {},
    composer: {
      async handleCallback(cq: any) {
        composerCallbacks.push(String(cq?.data ?? ''));
      },
      async startFromMessage() {},
      async handleInlineQuery() {},
    },
    maybeReopenForClarification: {},
    notifyTaskChanged() {},
    notifyCommentAdded() {},
    notifyStatusChanged(_p: string, _t: string, _o: string, n: string) { statusNotifs.push(n); },
  };
  return { h: new HandleTelegramWebhook(deps as any), answers, edits, sent, moves, upserts, statusNotifs, composerCallbacks };
}

function cbUpdate(data: string): TelegramUpdate {
  return {
    update_id: 1,
    callback_query: { id: 'cq1', from: { id: 111 }, message: { message_id: 10, chat: { id: 500 } }, data },
  } as any;
}

test('nd: «Завершить» → move в done + перерисовка + SSE', async () => {
  const h = makeCbHarness();
  await h.h.execute(cbUpdate('nd:t1'));
  assert.equal(h.moves.length, 1);
  assert.equal(h.moves[0].targetStatus, 'done');
  assert.equal(h.moves[0].taskId, 't1');
  assert.ok(h.answers.some((a) => a.text === '✅ Завершено'));
  assert.equal(h.edits.length, 1);
  assert.ok(h.edits[0]!.text.includes('Завершено'));
  assert.ok(h.statusNotifs.includes('done'));
});

test('nd: задача уже done → идемпотентно (без move)', async () => {
  const h = makeCbHarness({ task: { id: 't1', projectId: 'p1', status: 'done', statusBeforeDone: 'todo', description: 'x' } });
  await h.h.execute(cbUpdate('nd:t1'));
  assert.equal(h.moves.length, 0);
  assert.ok(h.answers.some((a) => (a.text ?? '').includes('Уже завершена')));
});

test('nd: нет TG-привязки → alert, без move', async () => {
  const h = makeCbHarness({ userId: null });
  await h.h.execute(cbUpdate('nd:t1'));
  assert.equal(h.moves.length, 0);
  assert.ok(h.answers.some((a) => a.showAlert === true));
});

test('nu: «Отменить» → restore в прежний статус', async () => {
  const h = makeCbHarness({ task: { id: 't1', projectId: 'p1', status: 'done', statusBeforeDone: 'in_progress', description: 'x' } });
  await h.h.execute(cbUpdate('nu:t1'));
  assert.equal(h.moves.length, 1);
  assert.equal(h.moves[0].restore, true);
  assert.equal(h.moves[0].targetStatus, 'in_progress');
  assert.ok(h.statusNotifs.includes('in_progress'));
});

test('nc: «Комментировать» → force-reply приглашение + маппинг задачи', async () => {
  const h = makeCbHarness();
  await h.h.execute(cbUpdate('nc:t1'));
  assert.equal(h.moves.length, 0);
  assert.equal(h.sent.length, 1);
  assert.equal((h.sent[0]!.replyMarkup as any).force_reply, true);
  assert.equal(h.upserts.length, 1);
  assert.equal(h.upserts[0].taskId, 't1');
  assert.equal(h.upserts[0].projectId, 'p1');
});

test('легаси da:/dd: коллбэки не роутятся отдельно — проваливаются в композер (гаснут молча)', async () => {
  const h = makeCbHarness();
  await h.h.execute(cbUpdate('da:del1'));
  await h.h.execute(cbUpdate('dd:del1'));
  assert.equal(h.moves.length, 0);
  assert.deepEqual(h.composerCallbacks, ['da:del1', 'dd:del1']);
});
