import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HandleTelegramWebhook, type TelegramUpdate } from './HandleTelegramWebhook.js';

// Фокусный тест: гейт групповых чатов (бот реагирует только на обращение к нему).
// Минимальные in-memory стабы (tsx + node:test).
function makeHarness(opts?: {
  senderUserId?: string | null;
  boundOwner?: string | null;
  composerGate?: Promise<void>;
  voiceTranscript?: string | Error;
  downloadedVoice?: { data: Buffer; filename: string; mimeType: string } | null;
}) {
  const composerCalls: {
    tgUserId: number;
    chatId: number;
    text: string;
    groupCtx: any;
    attachments: any[];
    options: any;
  }[] = [];
  const sent: { chatId: number; text: string }[] = [];
  const bindCalls: { tgChatId: number; ownerUserId: string }[] = [];
  const startedCalls: { userId: string; chatId: number }[] = [];
  const downloadedFileIds: string[] = [];
  const transcribedVoices: { data: Buffer; filename: string; mimeType: string }[] = [];
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
      async downloadFile(fileId: string) {
        downloadedFileIds.push(fileId);
        return opts && 'downloadedVoice' in opts
          ? (opts.downloadedVoice ?? null)
          : { data: Buffer.from('voice-bytes'), filename: 'voice.oga', mimeType: 'audio/ogg' };
      },
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
      async startFromMessage(
        tgUserId: number,
        chatId: number,
        text: string,
        groupCtx?: any,
        attachments: any[] = [],
        options?: any,
      ) {
        composerCalls.push({ tgUserId, chatId, text, groupCtx, attachments, options });
        await opts?.composerGate;
      },
      async handleCallback() {},
      async handleInlineQuery() {},
    },
    ...(opts && 'voiceTranscript' in opts
      ? {
          voiceTranscriber: {
            enabled: true,
            async transcribe(input: { data: Buffer; filename: string; mimeType: string }) {
              transcribedVoices.push(input);
              if (opts.voiceTranscript instanceof Error) throw opts.voiceTranscript;
              return opts.voiceTranscript!;
            },
          },
        }
      : {}),
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
    downloadedFileIds,
    transcribedVoices,
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

test('привязанная группа: голосовое без упоминания расшифровывается и становится предложением задачи', async () => {
  const x = makeHarness({
    boundOwner: 'owner-1',
    voiceTranscript: 'Проверить мобильную версию отчёта до пятницы',
  });
  const update: TelegramUpdate = {
    update_id: 2,
    message: {
      message_id: 22,
      from: { id: 777, first_name: 'Иван', username: 'ivan' },
      chat: { id: -100500, type: 'supergroup', title: 'Рабочая группа' },
      voice: {
        file_id: 'voice-file-id',
        file_unique_id: 'voice-unique-id',
        duration: 14,
        mime_type: 'audio/ogg',
        file_size: 1_024,
      },
    },
  };

  await x.h.execute(update);

  assert.deepEqual(x.downloadedFileIds, ['voice-file-id']);
  assert.equal(x.transcribedVoices.length, 1);
  assert.equal(x.transcribedVoices[0]!.filename, 'voice.oga');
  assert.equal(x.sent.length, 1);
  assert.match(x.sent[0]!.text, /Расшифровка голосового/);
  assert.match(x.sent[0]!.text, /Проверить мобильную версию отчёта до пятницы/);
  assert.match(x.sent[0]!.text, /@ProjectsFlow_Bot/);
  assert.equal(x.composerCalls.length, 1);
  assert.equal(x.composerCalls[0]!.text, 'Проверить мобильную версию отчёта до пятницы');
  assert.deepEqual(x.composerCalls[0]!.groupCtx, {
    ownerUserId: 'owner-1',
    senderName: 'Иван (@ivan)',
    groupTitle: 'Рабочая группа',
  });
  assert.equal(x.composerCalls[0]!.attachments[0]!.kind, 'voice');
  assert.deepEqual(x.composerCalls[0]!.options, {
    sourceKey: 'm:-100500:22',
    background: true,
  });

  // A duplicate webhook update must not produce a second transcription/proposal.
  await x.h.execute(update);
  assert.equal(x.transcribedVoices.length, 1);
  assert.equal(x.sent.length, 1);
  assert.equal(x.composerCalls.length, 1);
});

test('непривязанная группа: голосовое без упоминания остаётся без реакции', async () => {
  const x = makeHarness({ boundOwner: null, voiceTranscript: 'Это не рабочий чат' });
  await x.h.execute({
    update_id: 3,
    message: {
      message_id: 23,
      from: { id: 777, first_name: 'Иван' },
      chat: { id: -100501, type: 'supergroup', title: 'Посторонняя группа' },
      voice: { file_id: 'voice-file-id', duration: 4 },
    },
  });

  assert.equal(x.downloadedFileIds.length, 0);
  assert.equal(x.transcribedVoices.length, 0);
  assert.equal(x.sent.length, 0);
  assert.equal(x.composerCalls.length, 0);
});

test('ошибка расшифровки сообщает о проблеме и не создаёт пустую задачу', async () => {
  const x = makeHarness({ boundOwner: 'owner-1', voiceTranscript: new Error('provider down') });
  await x.h.execute({
    update_id: 4,
    message: {
      message_id: 24,
      from: { id: 777, first_name: 'Иван' },
      chat: { id: -100502, type: 'supergroup', title: 'Рабочая группа' },
      voice: { file_id: 'voice-file-id', duration: 4 },
    },
  });

  assert.equal(x.composerCalls.length, 0);
  assert.equal(x.sent.length, 1);
  assert.match(x.sent[0]!.text, /Не удалось расшифровать голосовое/);
});

test('личное фото с подписью передаётся в конструктор задачи', async () => {
  const x = makeHarness({ senderUserId: 'u1' });
  await x.h.execute({
    update_id: 2,
    message: {
      message_id: 11,
      from: { id: 111, first_name: 'U' },
      chat: { id: 500, type: 'private' },
      caption: 'Проверить этот экран',
      photo: [
        { file_id: 'small', file_unique_id: 'same', width: 90, height: 90, file_size: 100 },
        { file_id: 'large', file_unique_id: 'same', width: 1280, height: 720, file_size: 1_000 },
      ],
    },
  });
  assert.equal(x.composerCalls.length, 1);
  assert.equal(x.composerCalls[0]!.text, 'Проверить этот экран');
  assert.deepEqual(x.composerCalls[0]!.options, {
    sourceKey: 'm:500:11',
    background: true,
  });
  assert.equal(x.composerCalls[0]!.attachments[0]!.fileId, 'large');
  assert.equal(x.composerCalls[0]!.attachments[0]!.kind, 'photo');
  assert.equal(x.composerCalls[0]!.attachments[0]!.filename, 'telegram-photo-11.jpg');
});

test('личный альбом собирается в одну задачу со всеми фото', async () => {
  const x = makeHarness({ senderUserId: 'u1' });
  const base = {
    from: { id: 111, first_name: 'U' },
    chat: { id: 500, type: 'private' },
    media_group_id: 'album-1',
  } as const;
  const first = x.h.execute({
    update_id: 3,
    message: {
      ...base,
      message_id: 12,
      caption: 'Два экрана',
      photo: [{ file_id: 'one', file_unique_id: 'one-u', width: 800, height: 600 }],
    },
  });
  const second = x.h.execute({
    update_id: 4,
    message: {
      ...base,
      message_id: 13,
      photo: [{ file_id: 'two', file_unique_id: 'two-u', width: 800, height: 600 }],
    },
  });
  await Promise.all([first, second]);
  assert.equal(x.composerCalls.length, 1);
  assert.equal(x.composerCalls[0]!.text, 'Два экрана');
  assert.deepEqual(
    x.composerCalls[0]!.attachments.map((p) => p.fileId),
    ['one', 'two'],
  );
  assert.deepEqual(x.composerCalls[0]!.options, {
    sourceKey: 'g:500:111:album-1',
    background: true,
  });
});

test('media-group execute resolves only after durable composer intake completes', async () => {
  let releaseComposer!: () => void;
  const composerGate = new Promise<void>((resolve) => {
    releaseComposer = resolve;
  });
  const x = makeHarness({ senderUserId: 'u1', composerGate });
  let settled = false;
  const execution = x.h
    .execute({
      update_id: 5,
      message: {
        message_id: 14,
        from: { id: 111, first_name: 'U' },
        chat: { id: 500, type: 'private' },
        media_group_id: 'durable-1',
        caption: 'Сохранить надёжно',
        photo: [{ file_id: 'durable-photo', width: 800, height: 600 }],
      },
    })
    .finally(() => {
      settled = true;
    });

  await new Promise((resolve) => setTimeout(resolve, 1_050));
  assert.equal(x.composerCalls.length, 1, 'debounce flushed into composer');
  assert.equal(settled, false, 'update must not be acknowledged before durable intake');
  releaseComposer();
  await execution;
  assert.equal(settled, true);
});

test('document/video/audio/voice/animation/video_note сохраняют Telegram-метаданные', async () => {
  const x = makeHarness({ senderUserId: 'u1' });
  const base = {
    from: { id: 111, first_name: 'U' },
    chat: { id: 500, type: 'private' },
  } as const;
  const updates: TelegramUpdate[] = [
    {
      update_id: 10,
      message: {
        ...base,
        message_id: 20,
        caption: 'Документ',
        document: {
          file_id: 'doc-1',
          file_unique_id: 'doc-u',
          file_name: 'Техническое задание.pdf',
          mime_type: 'application/pdf',
          file_size: 123_456,
        },
      },
    },
    {
      update_id: 11,
      message: {
        ...base,
        message_id: 21,
        caption: 'Видео',
        video: {
          file_id: 'video-1',
          file_unique_id: 'video-u',
          file_name: 'demo.mp4',
          mime_type: 'video/mp4',
          file_size: 234_567,
          width: 1920,
          height: 1080,
          duration: 42,
        },
      },
    },
    {
      update_id: 12,
      message: {
        ...base,
        message_id: 22,
        caption: 'Аудио',
        audio: {
          file_id: 'audio-1',
          file_unique_id: 'audio-u',
          file_name: 'track.mp3',
          mime_type: 'audio/mpeg',
          file_size: 345_678,
          duration: 180,
        },
      },
    },
    {
      update_id: 13,
      message: {
        ...base,
        message_id: 23,
        voice: {
          file_id: 'voice-1',
          file_unique_id: 'voice-u',
          mime_type: 'audio/ogg',
          file_size: 456_789,
          duration: 9,
        },
      },
    },
    {
      update_id: 14,
      message: {
        ...base,
        message_id: 24,
        caption: 'Анимация',
        animation: {
          file_id: 'animation-1',
          file_unique_id: 'animation-u',
          file_name: 'demo.gif',
          mime_type: 'image/gif',
          file_size: 567_890,
          width: 640,
          height: 360,
          duration: 5,
        },
        // Telegram exposes the same animation as document for backwards compatibility.
        document: {
          file_id: 'animation-1',
          file_unique_id: 'animation-u',
          file_name: 'demo.gif',
          mime_type: 'image/gif',
          file_size: 567_890,
        },
      },
    },
    {
      update_id: 15,
      message: {
        ...base,
        message_id: 25,
        video_note: {
          file_id: 'note-1',
          file_unique_id: 'note-u',
          length: 384,
          duration: 7,
          file_size: 678_901,
        },
      },
    },
  ];

  for (const update of updates) await x.h.execute(update);

  assert.equal(x.composerCalls.length, 6);
  assert.deepEqual(
    x.composerCalls.map((call) => call.attachments.map((attachment) => attachment.kind)),
    [['document'], ['video'], ['audio'], ['voice'], ['animation'], ['video_note']],
  );
  assert.deepEqual(x.composerCalls[0]!.attachments[0], {
    key: 'doc-u',
    kind: 'document',
    fileId: 'doc-1',
    fileUniqueId: 'doc-u',
    filename: 'Техническое задание.pdf',
    mimeType: 'application/pdf',
    fileSize: 123_456,
    width: null,
    height: null,
    duration: null,
    targetSegmentIndexes: [],
  });
  assert.deepEqual(
    {
      filename: x.composerCalls[1]!.attachments[0]!.filename,
      mimeType: x.composerCalls[1]!.attachments[0]!.mimeType,
      width: x.composerCalls[1]!.attachments[0]!.width,
      height: x.composerCalls[1]!.attachments[0]!.height,
      duration: x.composerCalls[1]!.attachments[0]!.duration,
    },
    { filename: 'demo.mp4', mimeType: 'video/mp4', width: 1920, height: 1080, duration: 42 },
  );
  assert.equal(x.composerCalls[3]!.text, 'Аудио из Telegram');
  assert.equal(x.composerCalls[3]!.attachments[0]!.filename, 'telegram-voice-23.ogg');
  assert.equal(x.composerCalls[4]!.attachments.length, 1, 'animation/document duplicate');
  assert.equal(x.composerCalls[5]!.text, 'Видео из Telegram');
  assert.equal(x.composerCalls[5]!.attachments[0]!.width, 384);
  assert.equal(x.composerCalls[5]!.attachments[0]!.height, 384);
});

test('generalized media group uses caption from any update, sorts and deduplicates files', async () => {
  const x = makeHarness({ senderUserId: 'u1' });
  const base = {
    from: { id: 111, first_name: 'U' },
    chat: { id: 500, type: 'private' },
    media_group_id: 'mixed-1',
  } as const;

  // Arrival order is intentionally reversed. Both updates use the same unique id once, so the
  // duplicate must not create a third attachment.
  const later = x.h.execute({
    update_id: 31,
    message: {
      ...base,
      message_id: 32,
      caption: 'Проверить материалы',
      document: {
        file_id: 'doc-2',
        file_unique_id: 'doc-2-u',
        file_name: 'brief.pdf',
        mime_type: 'application/pdf',
        file_size: 20,
      },
    },
  });
  const earlier = x.h.execute({
    update_id: 30,
    message: {
      ...base,
      message_id: 31,
      video: {
        file_id: 'video-2',
        file_unique_id: 'video-2-u',
        file_name: 'walkthrough.mp4',
        mime_type: 'video/mp4',
        file_size: 10,
        width: 1280,
        height: 720,
        duration: 12,
      },
      document: {
        file_id: 'doc-duplicate-path',
        file_unique_id: 'doc-2-u',
        file_name: 'brief-copy.pdf',
        mime_type: 'application/pdf',
        file_size: 20,
      },
    },
  });

  await Promise.all([later, earlier]);

  assert.equal(x.composerCalls.length, 1);
  assert.equal(x.composerCalls[0]!.text, 'Проверить материалы');
  assert.deepEqual(
    x.composerCalls[0]!.attachments.map((attachment) => attachment.kind),
    ['video', 'document'],
  );
  assert.deepEqual(x.composerCalls[0]!.options, {
    sourceKey: 'g:500:111:mixed-1',
    background: true,
  });
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

test('dg: compact digest button completes one task without replacing the digest', async () => {
  const h = makeCbHarness();
  await h.h.execute(cbUpdate('dg:t1'));
  assert.equal(h.moves.length, 1);
  assert.equal(h.moves[0]!.targetStatus, 'done');
  assert.equal(h.edits.length, 0);
  assert.deepEqual(h.composerCallbacks, []);
});

test('легаси da:/dd: коллбэки не роутятся отдельно — проваливаются в композер (гаснут молча)', async () => {
  const h = makeCbHarness();
  await h.h.execute(cbUpdate('da:del1'));
  await h.h.execute(cbUpdate('dd:del1'));
  assert.equal(h.moves.length, 0);
  assert.deepEqual(h.composerCallbacks, ['da:del1', 'dd:del1']);
});
