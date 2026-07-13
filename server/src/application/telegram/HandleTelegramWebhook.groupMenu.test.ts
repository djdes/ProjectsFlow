import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HandleTelegramWebhook, type TelegramUpdate } from './HandleTelegramWebhook.js';

// Харнесс группового чата: привязка группы (boundOwner) + данные для меню по ответственным.
function makeHarness(opts?: {
  boundOwner?: string | null;
  senderUserId?: string | null;
  projects?: { id: string; name: string }[];
}) {
  const sent: { chatId: number; text: string; replyMarkup: any }[] = [];
  const composerCalls: { text: string }[] = [];
  const menuScopeUsers: string[] = [];
  let ralphLookups = 0;
  const boundOwner = opts?.boundOwner ?? null;
  const senderUserId = opts && 'senderUserId' in opts ? (opts.senderUserId ?? null) : 'sender1';

  const deps = {
    users: { async findUserIdByTelegramUserId() { return senderUserId; } },
    members: {
      // Фиксируем, ЧЕЙ охват запросили — меню должно строиться от владельца привязки.
      async listProjectsForUser(userId: string) {
        menuScopeUsers.push(userId);
        return opts?.projects ?? [{ id: 'p1', name: 'Сайт' }];
      },
      async findForProject() { return { role: 'editor' }; },
    },
    tasks: {
      async listByProject() {
        return [{ id: 't1', description: 'Задача владельца', status: 'todo', deadline: null }];
      },
    },
    delegations: {
      async listActiveForTasks() {
        return new Map([
          ['t1', { id: 'd1', taskId: 't1', status: 'accepted', delegateUserId: 'u-oleg', delegateDisplayName: 'Олег' }],
        ]);
      },
    },
    client: {
      async sendMessage(i: any) {
        sent.push({ chatId: i.chatId, text: i.text, replyMarkup: i.replyMarkup });
        return { kind: 'ok' as const, messageId: 1 };
      },
      async answerCallbackQuery() {},
    },
    appUrl: 'https://pf.test',
    signingSecret: 's',
    botUsername: 'ProjectsFlow_Bot',
    ralphQuestionMessages: { async findByMessage() { ralphLookups += 1; return null; } },
    taskMessages: { async findByMessage() { return null; }, async upsert() {} },
    groupOwners: {
      async getOwnerUserId() { return boundOwner; },
      async bindIfAbsent() { return { ownerUserId: 'x', created: false }; },
    },
    createComment: {},
    moveTask: {},
    confirmCloseProposal: {},
    dismissCloseProposal: {},
    dispatchCommentNotifications: {},
    composer: {
      async startFromMessage(_u: number, _c: number, text: string) { composerCalls.push({ text }); },
      async handleCallback() {},
      async handleInlineQuery() {},
    },
    maybeReopenForClarification: {},
    notifyTaskChanged() {},
    notifyCommentAdded() {},
    notifyStatusChanged() {},
  };
  return {
    h: new HandleTelegramWebhook(deps as any),
    sent,
    composerCalls,
    menuScopeUsers,
    ralphLookups: () => ralphLookups,
  };
}

function groupMsg(text: string, reply?: { is_bot: boolean }): TelegramUpdate {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      from: { id: 111, first_name: 'U' },
      chat: { id: -500, type: 'supergroup', title: 'Рабочий чат' },
      text,
      ...(reply ? { reply_to_message: { message_id: 9, from: { id: 999, is_bot: reply.is_bot } } } : {}),
    },
  };
}

test('группа: пустое @упоминание + привязка → меню по ответственным от ВЛАДЕЛЬЦА привязки', async () => {
  const h = makeHarness({ boundOwner: 'owner1' });
  await h.h.execute(groupMsg('@ProjectsFlow_Bot'));
  assert.equal(h.composerCalls.length, 0, 'composer не вызван');
  assert.equal(h.sent.length, 1);
  assert.deepEqual(h.menuScopeUsers, ['owner1'], 'охват — владелец привязки, не отправитель');
  const kb = h.sent[0]!.replyMarkup.inline_keyboard.flat();
  assert.ok(kb.some((b: any) => b.callback_data === 'ba:u-oleg'));
  assert.ok(kb.some((b: any) => b.callback_data === 'bt:root'));
});

test('группа: пустое @упоминание с пробелами/регистром → тоже меню', async () => {
  const h = makeHarness({ boundOwner: 'owner1' });
  await h.h.execute(groupMsg('  @projectsflow_bot  '));
  assert.equal(h.sent.length, 1);
  assert.equal(h.composerCalls.length, 0);
  assert.deepEqual(h.menuScopeUsers, ['owner1']);
});

test('группа: пустое @упоминание БЕЗ привязки → просьба /start, без меню и composer', async () => {
  const h = makeHarness({ boundOwner: null });
  await h.h.execute(groupMsg('@ProjectsFlow_Bot'));
  assert.equal(h.composerCalls.length, 0);
  assert.equal(h.menuScopeUsers.length, 0);
  assert.equal(h.sent.length, 1);
  assert.ok(h.sent[0]!.text.includes('/start'));
});

test('группа: @упоминание С ТЕКСТОМ → composer (создание задачи), как раньше', async () => {
  const h = makeHarness({ boundOwner: 'owner1' });
  await h.h.execute(groupMsg('@ProjectsFlow_Bot купить домен'));
  assert.equal(h.composerCalls.length, 1);
  assert.equal(h.composerCalls[0]!.text, 'купить домен');
  assert.equal(h.menuScopeUsers.length, 0, 'меню не показано');
});

test('группа: reply на бота с текстом-упоминанием → reply-ветка приоритетнее меню', async () => {
  const h = makeHarness({ boundOwner: 'owner1' });
  await h.h.execute(groupMsg('@ProjectsFlow_Bot', { is_bot: true }));
  assert.equal(h.ralphLookups(), 1, 'дошли до handleReply');
  assert.equal(h.menuScopeUsers.length, 0, 'меню не показано');
});

test('группа: пустое упоминание, владелец привязан, но без проектов → «📭»-заглушка', async () => {
  const h = makeHarness({ boundOwner: 'owner1', projects: [] });
  await h.h.execute(groupMsg('@ProjectsFlow_Bot'));
  assert.equal(h.sent.length, 1);
  assert.ok(h.sent[0]!.text.includes('📭'));
});
