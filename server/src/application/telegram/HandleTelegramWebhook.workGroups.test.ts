import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HandleTelegramWebhook, type TelegramUpdate } from './HandleTelegramWebhook.js';
import type { OnboardingPromptInput } from './TelegramGroupOnboarding.js';

// Рабочие группы пространства (db/181): привязка по коду, /id, приветствие, переезд группы,
// гейт подключения людей. Минимальные стабы (tsx + node:test).
function makeHarness(opts: {
  workGroup?: { workspaceId: string; workspaceName: string } | null;
  senderUserId?: string | null;
  member?: boolean;
  bindResult?: { kind: string; workspaceName?: string };
  voiceTranscript?: string;
} = {}) {
  const sent: Array<{ chatId: number; text: string }> = [];
  const composerCalls: Array<{ text: string; groupCtx: unknown }> = [];
  const prompts: OnboardingPromptInput[] = [];
  const privateStarts: Array<{ id: string; chatId: number; fromId: number }> = [];
  const joinCallbacks: Array<{ cqId: string; id: string }> = [];
  const binds: Array<{ code: string; chatId: number; title: string | null }> = [];
  const migrations: Array<[number, number]> = [];
  const groupStarts: number[] = [];
  const pairedTelegramIds: number[] = [];
  const bindSenders: number[] = [];
  let workGroup = opts.workGroup ?? null;

  const deps = {
    users: {
      async findUserIdByTelegramUserId() { return opts.senderUserId ?? null; },
      async getById(id: string) { return { id, displayName: 'Владелец' }; },
      async markTelegramStarted() {},
    },
    members: {},
    tasks: {},
    client: {
      async sendMessage(i: { chatId: number; text: string }) { sent.push({ chatId: i.chatId, text: i.text }); return { kind: 'ok' as const, messageId: 1 }; },
      async answerCallbackQuery() {},
      async downloadFile() { return { data: Buffer.from('v'), filename: 'voice.oga', mimeType: 'audio/ogg' }; },
    },
    appUrl: 'https://pf.test',
    botUsername: 'ProjectsFlow_Bot',
    ralphQuestionMessages: { async findByMessage() { return null; } },
    taskMessages: { async findByMessage() { return null; } },
    createComment: {},
    dispatchCommentNotifications: {},
    groupOwners: {
      async getOwnerUserId() { return null; },
      async bindIfAbsent(tgChatId: number) { groupStarts.push(tgChatId); return { ownerUserId: 'u', created: true }; },
    },
    composer: {
      async startFromMessage(_tg: number, _chat: number, text: string, groupCtx?: unknown) { composerCalls.push({ text, groupCtx }); },
      async handleCallback() {},
      async handleInlineQuery() {},
    },
    workGroups: {
      async bindFromCode(code: string, chat: { id: number; title: string | null }, sender: number) {
        binds.push({ code, chatId: chat.id, title: chat.title });
        bindSenders.push(sender);
        const result = opts.bindResult ?? { kind: 'bound', workspaceName: 'Программисты' };
        if (result.kind === 'bound') workGroup = { workspaceId: 'ws1', workspaceName: 'Программисты' };
        return result;
      },
      async resolveChat() { return workGroup ? { ...workGroup, addedByUserId: null } : null; },
      async migrateChat(from: number, to: number) { migrations.push([from, to]); },
    },
    onboarding: {
      async prompt(input: OnboardingPromptInput) { prompts.push(input); },
      async handlePrivateStart(input: { id: string; chatId: number; from: { id: number } }) {
        privateStarts.push({ id: input.id, chatId: input.chatId, fromId: input.from.id });
      },
      async handleJoinCallback(cq: { id: string }, id: string) { joinCallbacks.push({ cqId: cq.id, id }); },
      async completeAfterPairing(tgUserId: number) { pairedTelegramIds.push(tgUserId); },
    },
    pairing: { async complete() { return 'connected' as const; } },
    isWorkspaceMember: async () => opts.member ?? false,
    greetingDelayMs: 0,
    ...(opts.voiceTranscript
      ? { voiceTranscriber: { enabled: true, async transcribe() { return opts.voiceTranscript!; } } }
      : {}),
    maybeReopenForClarification: {},
    notifyTaskChanged() {},
    notifyCommentAdded() {},
    notifyStatusChanged() {},
  };
  const h = new HandleTelegramWebhook(deps as never);
  return { h, sent, composerCalls, prompts, privateStarts, joinCallbacks, binds, migrations, groupStarts, pairedTelegramIds, bindSenders };
}

const CODE = 'B'.repeat(43);

function groupMessage(message: Record<string, unknown>): TelegramUpdate {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      from: { id: 777, first_name: 'Иван' },
      chat: { id: -1001, type: 'supergroup', title: 'Команда' },
      ...message,
    },
  } as TelegramUpdate;
}

test('группа: /start@bot wg_<code> привязывает группу, а не назначает владельца', async () => {
  const x = makeHarness();
  await x.h.execute(groupMessage({ text: `/start@ProjectsFlow_Bot wg_${CODE}` }));
  assert.deepEqual(x.binds, [{ code: CODE, chatId: -1001, title: 'Команда' }]);
  assert.deepEqual(x.bindSenders, [777], 'the sender is checked to be a group admin');
  assert.deepEqual(x.groupStarts, []);
  assert.match(x.sent[0]!.text, /Группа «Команда» подключена к пространству «Программисты»/);
});

test('группа: код другого пространства и устаревший код — понятные ответы', async () => {
  const taken = makeHarness({ bindResult: { kind: 'taken' } });
  await taken.h.execute(groupMessage({ text: `/start@ProjectsFlow_Bot wg_${CODE}` }));
  assert.match(taken.sent[0]!.text, /уже подключена к другому пространству/);
  const invalid = makeHarness({ bindResult: { kind: 'invalid' } });
  await invalid.h.execute(groupMessage({ text: `/start@ProjectsFlow_Bot wg_${CODE}` }));
  assert.match(invalid.sent[0]!.text, /Ссылка устарела/);
});

test('/id: в группе — id группы, в личке — подсказка', async () => {
  const x = makeHarness();
  await x.h.execute(groupMessage({ text: '/id@ProjectsFlow_Bot' }));
  assert.match(x.sent[0]!.text, /<code>-1001<\/code>/);
  await x.h.execute({
    update_id: 2,
    message: { message_id: 3, from: { id: 777 }, chat: { id: 777, type: 'private' }, text: '/id' },
  } as TelegramUpdate);
  assert.match(x.sent[1]!.text, /личный чат/);
});

test('бота добавили в группу вручную — приветствие с id; в рабочую группу — без приветствия', async () => {
  const x = makeHarness();
  await x.h.execute(groupMessage({ new_chat_members: [{ id: 42, is_bot: true, username: 'ProjectsFlow_Bot' }] }));
  assert.equal(x.sent.length, 1);
  assert.match(x.sent[0]!.text, /ID этой группы: <code>-1001<\/code>/);
  const bound = makeHarness({ workGroup: { workspaceId: 'ws1', workspaceName: 'Программисты' } });
  await bound.h.execute(groupMessage({ new_chat_members: [{ id: 42, is_bot: true, username: 'ProjectsFlow_Bot' }] }));
  assert.equal(bound.sent.length, 0);
  // Чужой бот или человек — тишина.
  const other = makeHarness();
  await other.h.execute(groupMessage({ new_chat_members: [{ id: 43, is_bot: false, username: 'petr' }] }));
  assert.equal(other.sent.length, 0);
});

test('переезд группы в супергруппу переносит привязку', async () => {
  const x = makeHarness();
  await x.h.execute(groupMessage({ chat: { id: -5, type: 'group' }, migrate_to_chat_id: -1009 }));
  assert.deepEqual(x.migrations, [[-5, -1009]]);
});

test('рабочая группа: непривязанный автор → инструкция, задача ждёт подключения', async () => {
  const x = makeHarness({ workGroup: { workspaceId: 'ws1', workspaceName: 'Программисты' }, senderUserId: null });
  await x.h.execute(groupMessage({ text: '@ProjectsFlow_Bot Сделать отчёт' }));
  assert.equal(x.composerCalls.length, 0);
  assert.equal(x.prompts.length, 1);
  assert.deepEqual(
    { text: x.prompts[0]!.text, ws: x.prompts[0]!.workspaceId, linked: x.prompts[0]!.linkedUserId, reply: x.prompts[0]!.replyToMessageId },
    { text: 'Сделать отчёт', ws: 'ws1', linked: null, reply: 10 },
  );
});

test('рабочая группа: привязанный, но не участник → инструкция с вступлением', async () => {
  const x = makeHarness({ workGroup: { workspaceId: 'ws1', workspaceName: 'Программисты' }, senderUserId: 'u-ivan', member: false });
  await x.h.execute(groupMessage({ text: '@ProjectsFlow_Bot Сделать отчёт' }));
  assert.equal(x.composerCalls.length, 0);
  assert.equal(x.prompts[0]!.linkedUserId, 'u-ivan');
});

test('рабочая группа: участник пространства → обычный конструктор', async () => {
  const x = makeHarness({ workGroup: { workspaceId: 'ws1', workspaceName: 'Программисты' }, senderUserId: 'u-ivan', member: true });
  await x.h.execute(groupMessage({ text: '@ProjectsFlow_Bot Сделать отчёт' }));
  assert.equal(x.prompts.length, 0);
  assert.equal(x.composerCalls.length, 1);
  assert.equal(x.composerCalls[0]!.text, 'Сделать отчёт');
});

test('обычная группа (не рабочая) — без изменений: непривязанный идёт в конструктор', async () => {
  const x = makeHarness({ workGroup: null, senderUserId: null });
  await x.h.execute(groupMessage({ text: '@ProjectsFlow_Bot Сделать отчёт' }));
  assert.equal(x.prompts.length, 0);
  assert.equal(x.composerCalls.length, 1);
});

test('рабочая группа: голосовое неподключённого — расшифровка ждёт подключения', async () => {
  const x = makeHarness({
    workGroup: { workspaceId: 'ws1', workspaceName: 'Программисты' },
    senderUserId: null,
    voiceTranscript: 'Позвонить клиенту',
  });
  await x.h.execute(groupMessage({ voice: { file_id: 'f', duration: 3 } }));
  assert.equal(x.composerCalls.length, 0);
  assert.equal(x.prompts[0]!.text, 'Позвонить клиенту');
});

test('личка: /start wj_<id> и кнопка wj: уходят в подключение', async () => {
  const x = makeHarness();
  await x.h.execute({
    update_id: 3,
    message: { message_id: 4, from: { id: 777 }, chat: { id: 777, type: 'private' }, text: '/start wj_abcdefghijkl' },
  } as TelegramUpdate);
  assert.deepEqual(x.privateStarts, [{ id: 'abcdefghijkl', chatId: 777, fromId: 777 }]);
  await x.h.execute({ update_id: 4, callback_query: { id: 'cq', from: { id: 777 }, data: 'wj:abcdefghijkl' } } as TelegramUpdate);
  assert.deepEqual(x.joinCallbacks, [{ cqId: 'cq', id: 'abcdefghijkl' }]);
});

test('группа: не администратор — отказ; повтор доставки после привязки — без «ссылка устарела»', async () => {
  const notAdmin = makeHarness({ bindResult: { kind: 'not_admin' } });
  await notAdmin.h.execute(groupMessage({ text: `/start@ProjectsFlow_Bot wg_${CODE}` }));
  assert.match(notAdmin.sent[0]!.text, /только её администратор/);
  const bound = makeHarness({
    bindResult: { kind: 'invalid' },
    workGroup: { workspaceId: 'ws1', workspaceName: 'Программисты' },
  });
  await bound.h.execute(groupMessage({ text: `/start@ProjectsFlow_Bot wg_${CODE}` }));
  assert.match(bound.sent[0]!.text, /уже подключена к пространству «Программисты»/);
});

test('личка: привязка Telegram обычной ссылкой создаёт задачи, ждавшие этого человека', async () => {
  const x = makeHarness();
  await x.h.execute({
    update_id: 5,
    message: {
      message_id: 6,
      from: { id: 777 },
      chat: { id: 777, type: 'private' },
      text: `/start connect_${'A'.repeat(43)}`,
    },
  } as TelegramUpdate);
  assert.match(x.sent[0]!.text, /Telegram подключён/);
  assert.deepEqual(x.pairedTelegramIds, [777]);
});

test('CSharpFixer: configured chat bypasses account onboarding for text and voice', async () => {
  const keys = ['CSHARP_FIXER_CHAT_ID', 'CSHARP_FIXER_PROJECT_ID', 'CSHARP_FIXER_SIGNING_KEY'];
  const saved = keys.map(key => process.env[key]);
  Object.assign(process.env, { CSHARP_FIXER_CHAT_ID: '-1001', CSHARP_FIXER_PROJECT_ID: 'fixer',
    CSHARP_FIXER_SIGNING_KEY: 'test-only-signing-key-12345678901234567890' });
  try {
    const text = makeHarness({ workGroup: { workspaceId: 'ws1', workspaceName: 'Scripts' } });
    await text.h.execute(groupMessage({ text: '@ProjectsFlow_Bot C#Config не открывается' }));
    assert.equal(text.prompts.length, 0);
    assert.equal(text.composerCalls.length, 1);
    const voice = makeHarness({ workGroup: { workspaceId: 'ws1', workspaceName: 'Scripts' }, voiceTranscript: 'C#Config не открывается' });
    await voice.h.execute(groupMessage({ voice: { file_id: 'voice', duration: 1 }, reply_to_message: { message_id: 3, from: { id: 1, is_bot: true, username: 'ProjectsFlow_Bot' } } }));
    assert.equal(voice.prompts.length, 0);
    assert.equal(voice.composerCalls.length, 1);
  } finally {
    keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; });
  }
});
