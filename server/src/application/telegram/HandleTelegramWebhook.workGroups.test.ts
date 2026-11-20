import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HandleTelegramWebhook, type TelegramUpdate } from './HandleTelegramWebhook.js';
import type { OnboardingPromptInput } from './TelegramGroupOnboarding.js';
import { signIncidentRequest } from './composer/incidentIntake.js';

// Рабочие группы пространства (db/181): привязка по коду, /id, приветствие, переезд группы,
// гейт подключения людей. Минимальные стабы (tsx + node:test).
function makeHarness(opts: {
  workGroup?: { workspaceId: string; workspaceName: string; mode?: 'standard' | 'incident' | 'mixed'; addedByUserId?: string | null } | null;
  senderUserId?: string | null;
  member?: boolean;
  bindResult?: { kind: string; workspaceName?: string };
  voiceTranscript?: string;
  botAdded?: { kind: string; workspaceName?: string; options?: Array<{ id: string; name: string }> };
  chooseResult?: { kind: string; workspaceName?: string };
  // Уточнение воркера, отправленное в группу: reply на него — ответ (db/193).
  clarification?: { task: { id: string; projectId: string; description: string }; recipientUserId: string };
} = {}) {
  const comments: Array<{ ownerUserId: string; body: string }> = [];
  const botAddedCalls: Array<{ chatId: number; title: string | null; inviter: number }> = [];
  const botRemovedCalls: number[] = [];
  const chooseCalls: Array<{ chatId: number; workspaceId: string; tgUserId: number }> = [];
  const transferCalls: Array<{ chatId: number; tgUserId: number; approve: boolean }> = [];
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
  const memberEvents: Array<[string, ...unknown[]]> = [];
  let workGroup = opts.workGroup ?? null;

  const deps = {
    users: {
      async findUserIdByTelegramUserId() { return opts.senderUserId ?? null; },
      async getById(id: string) { return { id, displayName: 'Владелец' }; },
      async markTelegramStarted() {},
    },
    members: {},
    tasks: { async getById() { return opts.clarification?.task ?? null; } },
    maybeReopenForClarification: { async execute() { return null; } },
    notifyTaskChanged() {},
    client: {
      async sendMessage(i: { chatId: number; text: string }) { sent.push({ chatId: i.chatId, text: i.text }); return { kind: 'ok' as const, messageId: 1 }; },
      async answerCallbackQuery() {},
      async editMessageText(i: { chatId: number; text?: string }) { sent.push({ chatId: i.chatId, text: i.text ?? '' }); },
      async downloadFile() { return { data: Buffer.from('v'), filename: 'voice.oga', mimeType: 'audio/ogg' }; },
    },
    appUrl: 'https://pf.test',
    botUsername: 'ProjectsFlow_Bot',
    ralphQuestionMessages: {
      async findByMessage() {
        const c = opts.clarification;
        return c ? { taskId: c.task.id, ralphQuestionId: 'q1', recipientUserId: c.recipientUserId } : null;
      },
    },
    taskMessages: { async findByMessage() { return null; } },
    createComment: {
      async execute(i: { ownerUserId: string; body: string }) { comments.push(i); return { id: 'c1' }; },
    },
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
      async resolveChat() { return workGroup ? { addedByUserId: null, mode: 'standard' as const, ...workGroup } : null; },
      async migrateChat(from: number, to: number) { migrations.push([from, to]); },
      async handleBotAdded(chat: { id: number; title: string | null }, inviter: number) {
        botAddedCalls.push({ chatId: chat.id, title: chat.title, inviter });
        return opts.botAdded ?? { kind: 'not_linked' };
      },
      async handleBotRemoved(chatId: number) { botRemovedCalls.push(chatId); },
      async chooseDraftWorkspace(chat: { id: number }, workspaceId: string, tgUserId: number) {
        chooseCalls.push({ chatId: chat.id, workspaceId, tgUserId });
        return opts.chooseResult ?? { kind: 'draft', workspaceName: 'Офис' };
      },
      async decideTransferFromTelegram(chatId: number, tgUserId: number, approve: boolean) {
        transferCalls.push({ chatId, tgUserId, approve });
        return tgUserId === 801
          ? { kind: approve ? 'approved' : 'rejected', groupTitle: 'Офис', toWorkspaceName: 'Программисты' }
          : { kind: 'forbidden' };
      },
    },
    groupMembers: {
      async recordMessageAuthor(chatId: number, tgUserId: number) { memberEvents.push(['author', chatId, tgUserId]); },
      async handleMemberUpdate(chatId: number, tgUserId: number, status: string, o?: unknown) {
        memberEvents.push(['update', chatId, tgUserId, status, ...(o && Object.keys(o).length ? [o] : [])]);
      },
      async handleBotRightsChanged(chatId: number, isAdmin: boolean) { memberEvents.push(['bot', chatId, isAdmin]); },
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
  return {
    h, sent, composerCalls, prompts, comments, privateStarts, joinCallbacks, binds, migrations, groupStarts,
    pairedTelegramIds, bindSenders, botAddedCalls, botRemovedCalls, chooseCalls, transferCalls, memberEvents,
  };
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

function myChatMember(newStatus: string, oldStatus = 'left'): TelegramUpdate {
  return {
    update_id: 5,
    my_chat_member: {
      chat: { id: -1001, type: 'supergroup', title: 'Команда' },
      from: { id: 777 },
      new_chat_member: { status: newStatus, user: { id: 42 } },
      old_chat_member: { status: oldStatus },
    },
  } as TelegramUpdate;
}

test('my_chat_member: бота добавили — черновик в пространстве пригласившего, сообщение в группу', async () => {
  const x = makeHarness({ botAdded: { kind: 'draft', workspaceName: 'Программисты' } });
  await x.h.execute(myChatMember('member'));
  assert.deepEqual(x.botAddedCalls, [{ chatId: -1001, title: 'Команда', inviter: 777 }]);
  assert.equal(x.sent.length, 1);
  assert.equal(x.sent[0]!.chatId, -1001);
  assert.match(x.sent[0]!.text, /добавлена в пространство «Программисты» и ждёт подтверждения/);
  // Приветствие «как подключить» после черновика не дублируется.
  await x.h.execute(groupMessage({ new_chat_members: [{ id: 42, is_bot: true, username: 'ProjectsFlow_Bot' }] }));
  assert.equal(x.sent.length, 1);
});

test('my_chat_member: несколько пространств — выбор кнопками в личке пригласившего', async () => {
  const x = makeHarness({
    botAdded: {
      kind: 'choose',
      options: [
        { id: '11111111-1111-1111-1111-111111111111', name: 'Программисты' },
        { id: '22222222-2222-2222-2222-222222222222', name: 'Офис' },
      ],
    },
  });
  await x.h.execute(myChatMember('administrator'));
  assert.equal(x.sent.length, 1);
  assert.equal(x.sent[0]!.chatId, 777, 'choice goes to the inviter DM, not to the group');
  await x.h.execute({
    update_id: 6,
    callback_query: {
      id: 'cq1',
      from: { id: 777 },
      message: { message_id: 9, chat: { id: 777 } },
      data: 'wd:-1001:22222222-2222-2222-2222-222222222222',
    },
  } as TelegramUpdate);
  assert.deepEqual(x.chooseCalls, [
    { chatId: -1001, workspaceId: '22222222-2222-2222-2222-222222222222', tgUserId: 777 },
  ]);
  assert.match(x.sent.at(-1)!.text, /добавлена в пространство «Офис»/);
});

test('my_chat_member: смена прав уже добавленного бота — не новое добавление', async () => {
  const x = makeHarness({ botAdded: { kind: 'draft', workspaceName: 'Программисты' } });
  await x.h.execute(myChatMember('administrator', 'member'));
  assert.deepEqual(x.botAddedCalls, []);
});

test('my_chat_member: бота удалили — группа отключается', async () => {
  const x = makeHarness();
  await x.h.execute(myChatMember('kicked', 'member'));
  await x.h.execute(myChatMember('left', 'administrator'));
  assert.deepEqual(x.botRemovedCalls, [-1001, -1001]);
  assert.equal(x.sent.length, 0);
});

test('группа инцидентов: любой участник без аккаунта идёт в композер с режимом incident', async () => {
  const group = { workspaceId: 'ws1', workspaceName: 'YesBeat', mode: 'incident' as const, addedByUserId: 'u-lead' };
  const text = makeHarness({ workGroup: group, senderUserId: null });
  await text.h.execute(groupMessage({ text: '@ProjectsFlow_Bot Не открывается отчёт' }));
  assert.equal(text.prompts.length, 0, 'no account onboarding in an incident group');
  assert.equal(text.composerCalls.length, 1);
  assert.deepEqual((text.composerCalls[0]!.groupCtx as { incident?: unknown }).incident, { addedByUserId: 'u-lead', mode: 'incident' });
  const voice = makeHarness({ workGroup: group, senderUserId: null, voiceTranscript: 'Не открывается отчёт' });
  await voice.h.execute(groupMessage({ voice: { file_id: 'voice', duration: 1 }, reply_to_message: { message_id: 3, from: { id: 1, is_bot: true, username: 'ProjectsFlow_Bot' } } }));
  assert.equal(voice.prompts.length, 0);
  assert.deepEqual((voice.composerCalls[0]!.groupCtx as { incident?: unknown }).incident, { addedByUserId: 'u-lead', mode: 'incident' });
});

test('обычная рабочая группа не получает режим incident', async () => {
  const x = makeHarness({ workGroup: { workspaceId: 'ws1', workspaceName: 'Программисты' }, senderUserId: 'u-ivan', member: true });
  await x.h.execute(groupMessage({ text: '@ProjectsFlow_Bot Сделать отчёт' }));
  assert.equal((x.composerCalls[0]!.groupCtx as { incident?: unknown }).incident, undefined);
});

test('запрос на перенос: кнопки в личке владельца решают перенос, чужое нажатие — нет', async () => {
  const x = makeHarness();
  const press = (from: number, data: string) => x.h.execute({
    update_id: 7,
    callback_query: { id: 'cq2', from: { id: from }, message: { message_id: 10, chat: { id: from } }, data },
  } as TelegramUpdate);
  await press(802, 'wt:a:-3001');
  assert.equal(x.sent.length, 0, 'not the owner: only an alert');
  await press(801, 'wt:a:-3001');
  assert.match(x.sent.at(-1)!.text, /Перенос группы «Офис» в «Программисты» разрешён/);
  await press(801, 'wt:r:-3001');
  assert.match(x.sent.at(-1)!.text, /отклонён/);
  assert.deepEqual(x.transferCalls, [
    { chatId: -3001, tgUserId: 802, approve: true },
    { chatId: -3001, tgUserId: 801, approve: true },
    { chatId: -3001, tgUserId: 801, approve: false },
  ]);
});
// Участники рабочих групп (db/191).
test('участники группы: автор сообщения записывается, даже без упоминания бота; боты — нет', async () => {
  const x = makeHarness();
  await x.h.execute(groupMessage({ text: 'просто болтаем' }));
  await x.h.execute(groupMessage({ text: 'я бот', from: { id: 888, is_bot: true } }));
  assert.deepEqual(x.memberEvents, [['author', -1001, 777]]);
  assert.equal(x.composerCalls.length, 0);
});

test('участники группы: вступление и выход из сервисных сообщений (без бота)', async () => {
  const x = makeHarness();
  await x.h.execute(groupMessage({ new_chat_members: [{ id: 601 }, { id: 42, is_bot: true, username: 'Other_Bot' }] }));
  await x.h.execute(groupMessage({ left_chat_member: { id: 601 } }));
  assert.deepEqual(x.memberEvents, [
    ['update', -1001, 601, 'member'],
    ['update', -1001, 601, 'left'],
  ]);
});

test('chat_member: статус участника передаётся, боты и личка пропускаются', async () => {
  const x = makeHarness();
  const chatMember = (status: string, user: { id: number; is_bot?: boolean }, type = 'supergroup', extra = {}) => ({
    update_id: 9,
    chat_member: {
      chat: { id: -1001, type },
      new_chat_member: { status, user, ...extra },
    },
  }) as TelegramUpdate;
  await x.h.execute(chatMember('administrator', { id: 610 }));
  await x.h.execute(chatMember('restricted', { id: 611 }, 'supergroup', { is_member: false }));
  await x.h.execute(chatMember('member', { id: 612, is_bot: true }));
  await x.h.execute(chatMember('member', { id: 613 }, 'private'));
  assert.deepEqual(x.memberEvents, [
    ['update', -1001, 610, 'administrator'],
    ['update', -1001, 611, 'restricted', { isMember: false }],
  ]);
});

test('my_chat_member: бот стал администратором / снят — участникам сообщается', async () => {
  const x = makeHarness({ botAdded: { kind: 'active' } });
  await x.h.execute(myChatMember('administrator', 'member'));
  await x.h.execute(myChatMember('member', 'administrator'));
  assert.deepEqual(x.memberEvents, [['bot', -1001, true], ['bot', -1001, false]]);
});

test('смешанная группа: без исполнителя — в композер как задача воркеру, аккаунт автору не нужен', async () => {
  const group = { workspaceId: 'ws1', workspaceName: 'YesBeat', mode: 'mixed' as const, addedByUserId: 'u-lead' };
  const text = makeHarness({ workGroup: group, senderUserId: null });
  await text.h.execute(groupMessage({ text: '@ProjectsFlow_Bot в конфиге не сохраняется тариф' }));
  assert.equal(text.prompts.length, 0, 'без онбординга аккаунта');
  assert.equal(text.composerCalls.length, 1);
  assert.deepEqual((text.composerCalls[0]!.groupCtx as { incident?: unknown }).incident, { addedByUserId: 'u-lead', mode: 'mixed' });
  const voice = makeHarness({ workGroup: group, senderUserId: null, voiceTranscript: 'на есбите пропала кнопка' });
  await voice.h.execute(groupMessage({ voice: { file_id: 'voice', duration: 1 }, reply_to_message: { message_id: 3, from: { id: 1, is_bot: true, username: 'ProjectsFlow_Bot' } } }));
  assert.equal(voice.prompts.length, 0);
  assert.deepEqual((voice.composerCalls[0]!.groupCtx as { incident?: unknown }).incident, { addedByUserId: 'u-lead', mode: 'mixed' });
});

test('смешанная группа: с исполнителем — задача человеку; автор без аккаунта ставит её от подключившего группу', async () => {
  const group = { workspaceId: 'ws1', workspaceName: 'YesBeat', mode: 'mixed' as const, addedByUserId: 'u-lead' };
  const member = makeHarness({ workGroup: group, senderUserId: 'u-ivan', member: true });
  await member.h.execute(groupMessage({ text: '@ProjectsFlow_Bot поправить плеер @djdes' }));
  assert.equal(member.composerCalls.length, 1);
  assert.equal((member.composerCalls[0]!.groupCtx as { incident?: unknown }).incident, undefined);
  const stranger = makeHarness({ workGroup: group, senderUserId: null });
  await stranger.h.execute(groupMessage({ text: '@ProjectsFlow_Bot поправить плеер @djdes' }));
  assert.equal(stranger.composerCalls.length, 1, 'без аккаунта задача всё равно ставится');
  assert.equal(stranger.prompts.length, 0, 'подключаться не просим');
  assert.equal((stranger.composerCalls[0]!.groupCtx as { actAsUserId?: string }).actAsUserId, 'u-lead');
  assert.equal((member.composerCalls[0]!.groupCtx as { actAsUserId?: string }).actAsUserId, undefined);
});

test('смешанная группа: на уточнение задачи воркеру отвечает только автор, на уточнение задачи человека — только адресат', async () => {
  const saved = process.env.TELEGRAM_ORIGIN_SIGNING_KEY;
  const key = 'mixed-signing-key-not-a-secret-123456789';
  process.env.TELEGRAM_ORIGIN_SIGNING_KEY = key;
  try {
    const group = { workspaceId: 'ws1', workspaceName: 'YesBeat', mode: 'mixed' as const, addedByUserId: 'u-lead' };
    const source = { chatId: -1001, userId: 777, messageId: 5, messageThreadId: null, senderName: 'Оля' };
    const workerTask = {
      id: 't1', projectId: 'p1',
      description: signIncidentRequest('Не сохраняется тариф', source, 'p1', key, { mode: 'mixed', runMode: 'full' }),
    };
    const reply = groupMessage({ text: 'В разделе тарифов', reply_to_message: { message_id: 50, from: { id: 1, is_bot: true, username: 'ProjectsFlow_Bot' } } });
    const worker = makeHarness({ workGroup: group, senderUserId: null, clarification: { task: workerTask, recipientUserId: 'u-lead' } });
    await worker.h.execute(reply);
    assert.equal(worker.comments.length, 1);
    assert.equal(worker.comments[0]!.ownerUserId, 'u-lead');
    assert.match(worker.comments[0]!.body, /через группу Telegram/);
    assert.match(worker.sent.at(-1)!.text, /Спасибо, ответ получен/);

    const strangerReply = groupMessage({ from: { id: 888, first_name: 'Чужой' }, text: 'Не знаю', reply_to_message: { message_id: 50, from: { id: 1, is_bot: true, username: 'ProjectsFlow_Bot' } } });
    const stranger = makeHarness({ workGroup: group, senderUserId: null, clarification: { task: workerTask, recipientUserId: 'u-lead' } });
    await stranger.h.execute(strangerReply);
    assert.equal(stranger.comments.length, 0);
    assert.match(stranger.sent.at(-1)!.text, /только автор задачи/);

    const personTask = { id: 't2', projectId: 'p1', description: 'Поправить плеер' };
    const person = makeHarness({ workGroup: group, senderUserId: 'u-ivan', clarification: { task: personTask, recipientUserId: 'u-denis' } });
    await person.h.execute(reply);
    assert.equal(person.comments.length, 0);
    assert.match(person.sent.at(-1)!.text, /только адресат/);
  } finally {
    if (saved === undefined) delete process.env.TELEGRAM_ORIGIN_SIGNING_KEY;
    else process.env.TELEGRAM_ORIGIN_SIGNING_KEY = saved;
  }
});

test('смешанная группа: привязанный не участник пространства — свои задачи, без воркера и онбординга', async () => {
  const group = { workspaceId: 'ws1', workspaceName: 'MAG', mode: 'mixed' as const, addedByUserId: 'u-lead' };
  const sub = makeHarness({ workGroup: group, senderUserId: 'u-sub', member: false });
  await sub.h.execute(groupMessage({ text: '@ProjectsFlow_Bot +SUB поправить отчёт' }));
  assert.equal(sub.prompts.length, 0);
  assert.equal(sub.composerCalls.length, 1);
  const ctx = sub.composerCalls[0]!.groupCtx as { incident?: unknown; actAsUserId?: string };
  assert.equal(ctx.incident, undefined, 'не воркеру группы');
  assert.equal(ctx.actAsUserId, undefined, 'от своего имени');
});
