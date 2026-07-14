import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HandleTelegramWebhook, type TelegramUpdate } from './HandleTelegramWebhook.js';

// Харнесс для /tasks + ba:/bt:root: фейки members/tasks с данными,
// клиент копит отправленные сообщения/ответы, taskMessages копит upsert'ы.
function makeHarness(opts?: {
  userId?: string | null;
  projects?: { id: string; name: string }[];
  tasksByProject?: Record<string, any[]>;
}) {
  const sent: { chatId: number; text: string; replyMarkup: any }[] = [];
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
      async getById() { return null; },
    },
    client: {
      async sendMessage(i: any) {
        sent.push({ chatId: i.chatId, text: i.text, replyMarkup: i.replyMarkup });
        return { kind: 'ok' as const, messageId: 100 + sent.length };
      },
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
  return { h: new HandleTelegramWebhook(deps as any), sent, answers, upserts };
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
