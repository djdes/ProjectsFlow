import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HandleTelegramWebhook, type TelegramUpdate } from './HandleTelegramWebhook.js';

// Харнесс для /tasks + ba:/bt:root: фейки members/tasks с данными,
// клиент копит отправленные сообщения/ответы, taskMessages копит upsert'ы.
function makeHarness(opts?: {
  userId?: string | null;
  projects?: { id: string; name: string }[];
  tasksByProject?: Record<string, any[]>;
  task?: any;
  attachments?: any[];
  richResult?: 'ok' | 'error' | 'delivery_unknown' | 'forbidden' | 'rate_limited' | 'missing';
}) {
  const sent: { chatId: number; text: string; replyMarkup: any }[] = [];
  const sentRich: any[] = [];
  const sentAttachments: any[] = [];
  const sentDocumentGroups: any[] = [];
  const events: string[] = [];
  const answers: { id: string; text?: string; showAlert?: boolean }[] = [];
  const upserts: any[] = [];
  const userId = opts && 'userId' in opts ? opts.userId! : 'viewer1';

  const deps = {
    users: { async findUserIdByTelegramUserId() { return userId; } },
    members: {
      async listProjectsForUser() { return opts?.projects ?? []; },
      async findForProject() { return { role: 'editor' }; },
    },
    tasks: {
      async listByProject(pid: string) {
        return (opts?.tasksByProject?.[pid] ?? []).map((t: any) => ({
          status: 'todo',
          deadline: null,
          ...t,
          assignee: t.assignee ?? { userId: 'viewer1', displayName: 'Я', avatarUrl: null },
        }));
      },
      async getById() { return opts?.task ?? null; },
    },
    attachments: { async listByTask() { return opts?.attachments ?? []; } },
    attachmentStorage: { async read() { return { data: Buffer.from('file'), mimeType: 'application/octet-stream' }; } },
    client: {
      async sendMessage(i: any) {
        events.push(`text:${i.text}`);
        sent.push({ chatId: i.chatId, text: i.text, replyMarkup: i.replyMarkup });
        return { kind: 'ok' as const, messageId: 100 + sent.length };
      },
      async sendAttachment(i: any) {
        events.push(`attachment:${i.filename}`);
        sentAttachments.push(i);
        return { kind: 'ok' as const, messageId: 500 + sentAttachments.length };
      },
      async sendDocuments(i: any) {
        events.push(`documents:${i.documents.length}`);
        sentDocumentGroups.push(i);
        return i.documents.map((_: any, index: number) => ({
          kind: 'ok' as const,
          messageId: 800 + index,
        }));
      },
      ...(opts?.richResult === 'missing'
        ? {}
        : {
            async sendRichMessage(i: any) {
              events.push(`rich:${i.html}`);
              sentRich.push(i);
              if (opts?.richResult === 'error') {
                return { kind: 'error' as const, description: 'rich unavailable' };
              }
              if (opts?.richResult === 'delivery_unknown') {
                return {
                  kind: 'error' as const,
                  description: 'connection reset',
                  deliveryUnknown: true,
                };
              }
              if (opts?.richResult === 'forbidden') {
                return { kind: 'forbidden' as const, description: 'bot blocked' };
              }
              if (opts?.richResult === 'rate_limited') {
                return { kind: 'rate_limited' as const, retryAfter: 30 };
              }
              return { kind: 'ok' as const, messageId: 700 + sentRich.length };
            },
          }),
      async answerCallbackQuery(id: string, o?: any) { answers.push({ id, ...(o ?? {}) }); },
    },
    appUrl: 'https://pf.test',
    signingSecret: 's',
    botUsername: 'ProjectsFlow_Bot',
    ralphQuestionMessages: { async findByMessage() { return null; } },
    taskMessages: {
      async findByMessage() { return null; },
      async upsert(i: any) { upserts.push(i); },
    },
    groupOwners: { async getOwnerUserId() { return null; } },
    createComment: {},
    moveTask: {},
    confirmCloseProposal: {},
    dismissCloseProposal: {},
    dispatchCommentNotifications: {},
    composer: { async handleCallback() {}, async startFromMessage() {}, async handleInlineQuery() {} },
    maybeReopenForClarification: {},
    notifyTaskChanged() {},
    notifyCommentAdded() {},
    notifyStatusChanged() {},
  };
  return {
    h: new HandleTelegramWebhook(deps as any),
    sent,
    sentRich,
    sentAttachments,
    sentDocumentGroups,
    events,
    answers,
    upserts,
  };
}

function tasksUpdate(): TelegramUpdate {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      from: { id: 111 },
      chat: { id: 111, type: 'private' },
      text: '/tasks',
    },
  };
}

function cbUpdate(data: string): TelegramUpdate {
  return {
    update_id: 1,
    callback_query: {
      id: 'cq1',
      from: { id: 111 },
      message: { message_id: 10, chat: { id: 111 } },
      data,
    },
  } as any;
}

const seed = {
  projects: [{ id: 'p1', name: 'Сайт' }],
  tasksByProject: {
    p1: [
      {
        id: 't1',
        description: 'Задача Олега',
        assignee: { userId: 'u-oleg', displayName: 'Олег', avatarUrl: null },
      },
      {
        id: 't2',
        description: 'Моя задача',
        assignee: { userId: 'viewer1', displayName: 'Я', avatarUrl: null },
      },
    ],
  },
};

test('/tasks → меню по ответственным (ba:-кнопки, bt:root), НЕ список проектов', async () => {
  const h = makeHarness(seed);
  await h.h.execute(tasksUpdate());
  assert.equal(h.sent.length, 1);
  const kb = h.sent[0]!.replyMarkup.inline_keyboard.flat();
  assert.ok(kb.some((b: any) => b.callback_data === 'ba:u-oleg'));
  assert.ok(kb.some((b: any) => b.callback_data === 'ba:viewer1'));
  assert.ok(!kb.some((b: any) => b.callback_data === 'ba:none'));
  assert.ok(kb.some((b: any) => b.callback_data === 'bt:root'));
  assert.ok(!kb.some((b: any) => (b.callback_data ?? '').startsWith('bt:p:')), 'проекты не на первом экране');
});

test('/tasks: нет проектов → «📭»-заглушка', async () => {
  const h = makeHarness({ projects: [] });
  await h.h.execute(tasksUpdate());
  assert.equal(h.sent.length, 1);
  assert.ok(h.sent[0]!.text.includes('📭'));
});

test('/tasks: непривязанный → просьба привязать', async () => {
  const h = makeHarness({ userId: null });
  await h.h.execute(tasksUpdate());
  assert.ok(h.sent[0]!.text.includes('привяжи'));
});

test('ba:<uid> → заголовок + карточки с nd/nc/url, каждая регистрируется в taskMessages', async () => {
  const h = makeHarness(seed);
  await h.h.execute(cbUpdate('ba:u-oleg'));
  // 1 заголовок + 1 карточка
  assert.equal(h.sent.length, 2);
  assert.ok(h.sent[0]!.text.includes('Олег'));
  const card = h.sent[1]!;
  assert.ok(card.text.includes('Задача Олега'));
  const kb = card.replyMarkup.inline_keyboard.flat();
  assert.ok(kb.some((b: any) => b.callback_data === 'nd:t1'));
  assert.ok(kb.some((b: any) => b.callback_data === 'nc:t1'));
  assert.ok(kb.some((b: any) => b.url === 'https://pf.test/projects/p1?task=t1'));
  // Регистрация reply→комментарий: upsert ровно для карточки (заголовок не регистрируем).
  assert.equal(h.upserts.length, 1);
  assert.deepEqual(
    { taskId: h.upserts[0].taskId, projectId: h.upserts[0].projectId, recipientUserId: h.upserts[0].recipientUserId },
    { taskId: 't1', projectId: 'p1', recipientUserId: 'viewer1' },
  );
  assert.ok(h.answers.some((a) => a.id === 'cq1'), 'callback подтверждён');
});

test('устаревший ba:none → alert без сообщений', async () => {
  const h = makeHarness(seed);
  await h.h.execute(cbUpdate('ba:none'));
  assert.equal(h.sent.length, 0);
  assert.ok(h.answers.some((a) => a.showAlert === true));
});

test('ba: у ответственного нет открытых задач → alert без сообщений', async () => {
  const h = makeHarness(seed);
  await h.h.execute(cbUpdate('ba:u-ghost'));
  assert.equal(h.sent.length, 0);
  assert.ok(h.answers.some((a) => a.showAlert === true));
});

test('ba: непривязанный → alert «привяжи», без карточек', async () => {
  const h = makeHarness({ ...seed, userId: null });
  await h.h.execute(cbUpdate('ba:u-oleg'));
  assert.equal(h.sent.length, 0);
  assert.ok(h.answers.some((a) => a.showAlert === true));
});

test('bt:root → старый экран «Выбери проект» (bt:p:-кнопки)', async () => {
  const h = makeHarness(seed);
  await h.h.execute(cbUpdate('bt:root'));
  assert.equal(h.sent.length, 1);
  assert.ok(h.sent[0]!.text.includes('Выбери проект'));
  const kb = h.sent[0]!.replyMarkup.inline_keyboard.flat();
  assert.ok(kb.some((b: any) => b.callback_data === 'bt:p:p1'));
  assert.ok(h.answers.some((a) => a.id === 'cq1'));
});

test('bt:p: кнопки задач подписаны plain-названием (первой строкой), не телом описания', async () => {
  const h = makeHarness({
    ...seed,
    tasksByProject: {
      p1: [{ id: 't1', description: '## **Название** задачи\n\nдлинное тело которое не должно попасть в кнопку' }],
    },
  });
  await h.h.execute(cbUpdate('bt:p:p1'));
  const kb = h.sent[0]!.replyMarkup.inline_keyboard.flat();
  const btn = kb.find((b: any) => b.callback_data === 'bt:t:t1');
  assert.ok(btn);
  assert.ok(btn.text.includes('Название задачи'), 'markdown снят');
  assert.ok(!btn.text.includes('длинное тело'), 'тело не попало в лейбл');
});

test('bt:t: скрин и поддерживаемые файлы остаются внутри одного rich-сообщения задачи', async () => {
  const h = makeHarness({
    ...seed,
    task: {
      id: 't1',
      projectId: 'p1',
      description: [
        'Заголовок',
        '',
        'До картинки',
        '',
        '<figure data-figure-image><img src="/api/attachments/img-1" alt="" /></figure>',
        '',
        'После картинки',
      ].join('\n'),
    },
    attachments: [
      {
        id: 'img-1',
        taskId: 't1',
        commentId: null,
        filename: 'screen.png',
        mimeType: 'image/png',
        sizeBytes: 10,
        storageKey: 'img-1.png',
        uploadedAt: new Date(),
      },
      {
        id: 'audio-1',
        taskId: 't1',
        commentId: null,
        filename: 'track.mp3',
        mimeType: 'audio/mpeg',
        sizeBytes: 20,
        storageKey: 'audio-1.mp3',
        uploadedAt: new Date(),
      },
      {
        id: 'doc-1',
        taskId: 't1',
        commentId: null,
        filename: 'brief.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 30,
        storageKey: 'doc-1.pdf',
        uploadedAt: new Date(),
      },
    ],
  });

  await h.h.execute(cbUpdate('bt:t:t1'));

  assert.deepEqual(
    h.events.map((event) => event.split(':', 1)[0]),
    ['rich'],
  );
  const rich = h.sentRich[0]!;
  assert.ok(rich.html.indexOf('До картинки') < rich.html.indexOf('tg://photo?id=task_photo_1'));
  assert.ok(rich.html.indexOf('tg://photo?id=task_photo_1') < rich.html.indexOf('После картинки'));
  assert.equal(rich.media.length, 2);
  assert.equal(rich.media[0].kind, 'photo');
  assert.match(rich.media[0].url, /\/api\/attachments\/img-1/);
  assert.ok(Buffer.isBuffer(rich.media[0].data), 'inline screenshot bytes are uploaded directly');
  assert.equal(rich.media[0].filename, 'screen.png');
  assert.equal(rich.media[0].mimeType, 'image/png');
  assert.equal(rich.media[1].kind, 'audio');
  assert.equal(rich.media[1].filename, 'track.mp3');
  assert.ok(rich.media.every((attachment: any) => Buffer.isBuffer(attachment.data)));
  assert.match(rich.html, /track\.mp3/);
  assert.match(rich.html, /brief\.pdf/);
  assert.match(rich.html, /Открыть в ProjectsFlow/);
  assert.equal(h.sentAttachments.length, 0, 'legacy one-by-one sender is not used');
  assert.equal(h.sentDocumentGroups.length, 0, 'task files must not fan out into replies');
  assert.equal(h.upserts.length, 1, 'only the single task card accepts reply comments');
});

test('bt:t: MP4 и WEBP прикрепляются непосредственно к одному сообщению задачи', async () => {
  const h = makeHarness({
    ...seed,
    task: { id: 't1', projectId: 'p1', description: 'Описание задачи' },
    attachments: [
      {
        id: 'video-1',
        taskId: 't1',
        commentId: null,
        filename: 'demo.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 20,
        storageKey: 'demo.mp4',
        uploadedAt: new Date(),
      },
      {
        id: 'image-1',
        taskId: 't1',
        commentId: null,
        filename: 'reference.webp',
        mimeType: 'image/webp',
        sizeBytes: 30,
        storageKey: 'reference.webp',
        uploadedAt: new Date(),
      },
    ],
  });

  await h.h.execute(cbUpdate('bt:t:t1'));

  assert.deepEqual(h.events.map((event) => event.split(':', 1)[0]), ['rich']);
  assert.deepEqual(h.sentRich[0]!.media.map((item: any) => item.kind), ['video', 'photo']);
  assert.equal(h.sentDocumentGroups.length, 0);
  assert.equal(h.upserts.length, 1);
});

test('bt:t: rich rejection falls back to one message with the screenshot link', async () => {
  const h = makeHarness({
    ...seed,
    richResult: 'error',
    task: {
      id: 't1',
      projectId: 'p1',
      description: [
        'До картинки',
        '<figure data-figure-image><img src="/api/attachments/img-1" alt="" /></figure>',
        'После картинки',
      ].join('\n'),
    },
    attachments: [
      {
        id: 'img-1',
        taskId: 't1',
        commentId: null,
        filename: 'screen.png',
        mimeType: 'image/png',
        sizeBytes: 10,
        storageKey: 'img-1.png',
        uploadedAt: new Date(),
      },
      {
        id: 'doc-1',
        taskId: 't1',
        commentId: null,
        filename: 'brief.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 20,
        storageKey: 'doc-1.pdf',
        uploadedAt: new Date(),
      },
    ],
  });

  await h.h.execute(cbUpdate('bt:t:t1'));

  assert.deepEqual(
    h.events.map((event) => event.split(':', 1)[0]),
    ['rich', 'text'],
  );
  assert.match(h.events[1]!, /До картинки/);
  assert.match(h.events[1]!, /После картинки/);
  assert.match(h.events[1]!, /screen\.png/);
  assert.match(h.events[1]!, /brief\.pdf/);
  assert.equal(h.sentAttachments.length, 0);
  assert.equal(h.sentDocumentGroups.length, 0);
  assert.equal(h.upserts.length, 1, 'fallback remains one registered task message');
});

test('bt:t: файл больше лимита Telegram остаётся доступен ссылкой и не грузится в album', async () => {
  const h = makeHarness({
    ...seed,
    task: { id: 't1', projectId: 'p1', description: 'Большой архив' },
    attachments: [
      {
        id: 'archive-1',
        taskId: 't1',
        commentId: null,
        filename: 'sources.zip',
        mimeType: 'application/zip',
        sizeBytes: 50 * 1024 * 1024 + 1,
        storageKey: 'sources.zip',
        uploadedAt: new Date(),
      },
    ],
  });

  await h.h.execute(cbUpdate('bt:t:t1'));

  assert.deepEqual(h.events.map((event) => event.split(':', 1)[0]), ['rich']);
  assert.match(h.sentRich[0]!.html, /sources\.zip/);
  assert.equal(h.sentDocumentGroups.length, 0);
});

for (const richResult of ['delivery_unknown', 'forbidden', 'rate_limited'] as const) {
  test(`bt:t: ${richResult} does not fan out a duplicate fallback`, async () => {
    const h = makeHarness({
      ...seed,
      richResult,
      task: { id: 't1', projectId: 'p1', description: 'Описание задачи' },
    });

    await h.h.execute(cbUpdate('bt:t:t1'));

    assert.equal(h.sentRich.length, 1);
    assert.equal(h.sent.length, 0);
    assert.equal(h.sentAttachments.length, 0);
    assert.equal(h.upserts.length, 0);
  });
}
