import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TelegramComposerService, type TelegramCallbackQuery } from './TelegramComposerService.js';
import type { TelegramTaskDraft } from '../TelegramTaskDraftRepository.js';

// --- Минимальные in-memory фейки (tsx + node:test, без новых deps). ---

type CreateTaskCall = {
  projectId: string;
  ownerUserId?: string;
  description: string;
  assigneeUserId?: string | null;
  deadline?: string | null;
  status?: string;
};

// Тексты кнопок из replyMarkup (для проверки пикера колонок).
function buttonTexts(replyMarkup: any): string[] {
  const rows = replyMarkup?.inline_keyboard ?? [];
  return rows.flat().map((b: any) => b.text as string);
}

// AI-мок: aiSegments → успех (compose вернул эти сегменты); aiOutcome → деградация
// (enqueue бросает / таймаут / job упал / битый JSON). По умолчанию (без обоих) — enqueue
// бросает, и конструктор откатывается на ручной флоу (этим режимом идут «старые» тесты).
type AiSeg = {
  id: string;
  title: string;
  simpleBody: string;
  projectId: string | null;
  projectName: string | null;
  confidence: number;
  assigneeUserId: string | null;
  assigneeName: string | null;
  deadline: string | null;
};

function makeHarness(opts?: {
  projects?: { id: string; name: string }[];
  shared?: { id: string; displayName: string; email: string }[];
  aiSegments?: AiSeg[];
  aiOutcome?: 'enqueue-throw' | 'timeout' | 'fail' | 'bad';
  // Per-project kanban settings (кастомные подписи/скрытость колонок) для пикера.
  kanbanByProject?: Record<string, any>;
}) {
  const projects = opts?.projects ?? [{ id: 'p1', name: 'Альфа' }];
  const shared = opts?.shared ?? [{ id: 'u2', displayName: 'Вася', email: 'v@e.com' }];
  const aiSegments = opts?.aiSegments;
  const aiOutcome = opts?.aiOutcome ?? (aiSegments ? undefined : 'enqueue-throw');
  const kanbanByProject = opts?.kanbanByProject ?? {};

  const drafts = new Map<string, TelegramTaskDraft>();
  let seq = 0;
  const createTaskCalls: CreateTaskCall[] = [];
  const sent: { chatId: number; text: string }[] = [];
  const edits: { messageId: number; text: string; replyMarkup?: any }[] = [];
  const answers: { text?: string }[] = [];
  const assigneeMessages: { userId: string; buttons: string; kind: string }[] = [];
  const inboxUserIds: string[] = [];
  const updatedDescriptions: string[] = [];

  const draftsRepo = {
    async create(input: any): Promise<TelegramTaskDraft> {
      const id = `d${++seq}`;
      const d: TelegramTaskDraft = {
        id,
        creatorUserId: input.creatorUserId,
        tgChatId: input.tgChatId,
        tgMessageId: input.tgMessageId ?? null,
        taskText: input.taskText,
        projectId: input.projectId ?? null,
        assigneeUserId: input.assigneeUserId ?? null,
        offered: input.offered ?? null,
        segments: input.segments ?? null,
        photos: input.photos ?? [],
        targetStatus: input.targetStatus ?? null,
        status: 'composing',
        createdAt: new Date(0),
        autoCreateAt:
          input.autoCreateSeconds == null ? null : new Date(Date.now() + input.autoCreateSeconds * 1000),
        confirmationStartedAt: null,
        expiresAt: new Date(8640000000000000),
      };
      drafts.set(id, d);
      return d;
    },
    async getById(id: string) {
      return drafts.get(id) ?? null;
    },
    async patch(id: string, patch: any) {
      const cur = drafts.get(id);
      if (!cur) return null;
      const next = { ...cur, ...patch } as TelegramTaskDraft;
      drafts.set(id, next);
      return next;
    },
    async listDueForAutoCreate() {
      return [...drafts.values()].filter(
        (d) => d.status === 'composing' && d.autoCreateAt && d.autoCreateAt <= new Date(),
      );
    },
    async claimForConfirmation(id: string, dueOnly: boolean) {
      const cur = drafts.get(id);
      if (!cur || cur.status !== 'composing') return null;
      if (dueOnly && (!cur.autoCreateAt || cur.autoCreateAt > new Date())) return null;
      const next = {
        ...cur,
        status: 'confirming' as const,
        confirmationStartedAt: new Date(),
      };
      drafts.set(id, next);
      return next;
    },
    async releaseConfirmation(id: string, retrySeconds: number) {
      const cur = drafts.get(id);
      if (!cur || cur.status !== 'confirming') return;
      drafts.set(id, {
        ...cur,
        status: 'composing',
        confirmationStartedAt: null,
        autoCreateAt: new Date(Date.now() + retrySeconds * 1000),
      });
    },
    async cancelComposing(id: string) {
      const cur = drafts.get(id);
      if (!cur || cur.status !== 'composing') return false;
      drafts.set(id, { ...cur, status: 'cancelled' });
      return true;
    },
    async recoverStaleConfirmations() {
      return 0;
    },
    async deleteExpired() {
      return 0;
    },
  };

  const client = {
    async sendMessage(input: any) {
      sent.push({ chatId: input.chatId, text: input.text, replyMarkup: input.replyMarkup });
      return { kind: 'ok' as const, messageId: 1000 + sent.length };
    },
    async editMessageText(input: any) {
      edits.push({ messageId: input.messageId, text: input.text, replyMarkup: input.replyMarkup });
    },
    async answerCallbackQuery(_id: string, opts?: { text?: string }) {
      answers.push({ text: opts?.text });
    },
    async answerInlineQuery() {},
    async setWebhook() {},
    async setMyCommands() {},
    async deleteWebhook() {},
    async getUpdates() {
      return [];
    },
    async downloadFile() {
      return {
        data: Buffer.from('image'),
        filename: 'telegram.jpg',
        mimeType: 'image/jpeg',
      };
    },
  };

  const deps = {
    drafts: draftsRepo,
    taskMessages: { async upsert() {}, async findByMessage() { return null; } },
    members: {
      async listProjectsForUser() {
        return projects.map((p) => ({ ...p, isInbox: false })) as any;
      },
      async listSharedUsers() {
        return shared as any;
      },
      async listByProject(projectId: string) {
        return [
          {
            projectId,
            userId: 'u1',
            role: 'owner',
            user: { id: 'u1', displayName: 'Создатель', email: 'c@e.com' },
          },
          ...shared.map((user) => ({
            projectId,
            userId: user.id,
            role: 'editor',
            user,
          })),
        ] as any;
      },
      async findForProject(projectId: string) {
        return { projectId, userId: 'u2', role: 'editor' } as any;
      },
    },
    projects: {
      async getById(id: string) {
        const p = projects.find((x) => x.id === id);
        return p ? ({ ...p, isInbox: false } as any) : ({ id, name: 'Входящие', isInbox: true } as any);
      },
      async getKanbanSettings(projectId: string) {
        return kanbanByProject[projectId] ?? null;
      },
    },
    users: {
      async findUserIdByTelegramUserId(tgId: number) {
        return tgId === 111 ? 'u1' : tgId === 222 ? 'u2' : null;
      },
      async getById(id: string) {
        const u = shared.find((x) => x.id === id);
        return u ? ({ id, displayName: u.displayName, email: u.email } as any) : ({ id, displayName: 'Создатель', email: 'c@e.com' } as any);
      },
    },
    createTask: {
      async execute(input: any) {
        createTaskCalls.push({
          projectId: input.projectId,
          ownerUserId: input.ownerUserId,
          description: input.description,
          assigneeUserId: input.assigneeUserId ?? input.ownerUserId,
          deadline: input.deadline ?? null,
          status: input.status,
        });
        return {
          id: 't1',
          projectId: input.projectId,
          assignee: {
            userId: input.assigneeUserId ?? input.ownerUserId,
            displayName: input.assigneeUserId === 'u2' ? 'Вася' : 'Создатель',
            avatarUrl: null,
          },
        } as any;
      },
    },
    getOrCreateInbox: {
      async execute(userId?: string) {
        if (userId) inboxUserIds.push(userId);
        return { id: 'inbox1', name: 'Входящие', isInbox: true } as any;
      },
    },
    sendNotification: {
      async execute(cmd: any) {
        assigneeMessages.push({
          userId: cmd.userId,
          buttons: JSON.stringify(cmd.replyMarkup ?? null),
          kind: cmd.kind,
        });
        return { status: 'ok' as const, messageId: 5000, chatId: 999 };
      },
    },
    enqueueAiPromptJob: {
      async execute(_input: any) {
        if (aiOutcome === 'enqueue-throw') throw new Error('ai disabled (тест → ручной флоу)');
        return { id: 'job1' } as any;
      },
    },
    waitForAiPromptJob: {
      async execute(_input: any) {
        if (aiOutcome === 'timeout') return null;
        if (aiOutcome === 'fail') return { status: 'failed', improvedText: null } as any;
        if (aiOutcome === 'bad') return { status: 'succeeded', improvedText: 'это не JSON' } as any;
        return {
          status: 'succeeded',
          improvedText: JSON.stringify({ version: 1, segments: aiSegments ?? [] }),
        } as any;
      },
    },
    client,
    uploadAttachment: {
      async execute() {
        return { id: 'att1' } as any;
      },
    },
    updateTask: {
      async execute(input: any) {
        updatedDescriptions.push(input.description);
        return {} as any;
      },
    },
    idGen: () => 'uuid',
    shortIdGen: () => `s${++seq}`,
    appUrl: 'https://pf.test',
  };

  const service = new TelegramComposerService(deps as any);
  return {
    service,
    drafts,
    createTaskCalls,
    sent,
    edits,
    answers,
    assigneeMessages,
    inboxUserIds,
    updatedDescriptions,
  };
}

function cq(draftIdOrData: string, tgUserId = 111): TelegramCallbackQuery {
  return {
    id: 'cq1',
    from: { id: tgUserId },
    message: { message_id: 99, chat: { id: 500 } },
    data: draftIdOrData,
  };
}

// --- Гибрид-маршрутизация групповых сообщений (groupCtx) ---
// tgId 111→u1, 222→u2, иначе не привязан. Владельцем групп в тестах ставим u1.

function gctx(ownerUserId: string | null, senderName = 'Отправитель', groupTitle: string | null = null) {
  return { ownerUserId, senderName, groupTitle };
}

test('группа: владелец (sender===owner) → флоу «как отправитель», без мгновенного createTask', async () => {
  const h = makeHarness();
  await h.service.startFromMessage(111, 500, 'починить сборку', gctx('u1', 'Босс'));
  assert.equal(h.createTaskCalls.length, 0); // ушли в self/manual флоу — createTask на confirm
  assert.equal(h.drafts.size, 1);
  assert.equal([...h.drafts.values()][0]!.creatorUserId, 'u1');
});

test('группа: привязанный коллега (не владелец) → флоу «как отправитель», в СВОё, не к владельцу', async () => {
  const h = makeHarness();
  await h.service.startFromMessage(222, 500, 'улучшить распознавание накладных', gctx('u1', 'Олег (@oleg)', 'Рабочий чат'));
  assert.equal(h.createTaskCalls.length, 0); // self/manual — createTask на confirm, НЕ мгновенно к владельцу
  assert.equal(h.drafts.size, 1);
  assert.equal([...h.drafts.values()][0]!.creatorUserId, 'u2'); // от своего лица
});

test('группа: коллега с +своим проектом → флоу «как отправитель» (черновик от него)', async () => {
  const h = makeHarness();
  await h.service.startFromMessage(222, 500, '+Альфа поправить парсинг', gctx('u1', 'Олег'));
  assert.equal(h.createTaskCalls.length, 0); // self/manual — createTask на confirm
  assert.equal(h.drafts.size, 1);
  const d = [...h.drafts.values()][0]!;
  assert.equal(d.creatorUserId, 'u2'); // действует как отправитель
  assert.equal(d.projectId, 'p1'); // в свой проект Альфа
});

test('группа: непривязанный отправитель при владельце → в «Входящие» владельца + кнопка «Привязать»', async () => {
  const h = makeHarness();
  await h.service.startFromMessage(999, 500, 'подготовить отчёт', gctx('u1', 'Гость'));
  assert.equal(h.createTaskCalls.length, 1);
  assert.equal(h.createTaskCalls[0]!.ownerUserId, 'u1');
  assert.equal(h.createTaskCalls[0]!.projectId, 'inbox1');
  assert.equal(h.drafts.size, 0);
  // предложение привязать аккаунт: url-кнопка на /profile
  const conf = h.sent[h.sent.length - 1]!;
  assert.ok(JSON.stringify(conf.replyMarkup ?? '').includes('/profile'));
});

test('группа: непривязанный + группа без владельца → подсказка про /start, ничего не создаём', async () => {
  const h = makeHarness();
  await h.service.startFromMessage(999, 500, 'что-то сделать', gctx(null, 'Гость'));
  assert.equal(h.createTaskCalls.length, 0);
  assert.equal(h.drafts.size, 0);
  assert.ok(h.sent.length >= 1);
  assert.ok(h.sent[0]!.text.includes('/start'));
});

test('голый текст → черновик во «Входящие», confirm → createTask в inbox', async () => {
  const h = makeHarness();
  await h.service.startFromMessage(111, 500, 'Купить кофе');
  assert.equal(h.sent.length, 1); // карточка-подтверждение
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`tc:${draftId}`));
  assert.equal(h.createTaskCalls.length, 1);
  assert.equal(h.createTaskCalls[0]!.projectId, 'inbox1'); // ушло в inbox
  assert.equal(h.createTaskCalls[0]!.description, 'Купить кофе');
  assert.equal(h.createTaskCalls[0]!.assigneeUserId, 'u1');
});

test('+Проект (уникальный) текст → createTask в этот проект', async () => {
  const h = makeHarness();
  await h.service.startFromMessage(111, 500, '+Альфа Обнови билд');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`tc:${draftId}`));
  assert.equal(h.createTaskCalls[0]!.projectId, 'p1');
  assert.equal(h.createTaskCalls[0]!.description, 'Обнови билд');
});

test('+неоднозначный проект → пикер, выбор кнопки → confirm → createTask', async () => {
  const h = makeHarness({
    projects: [
      { id: 'p1', name: 'Ралф core' },
      { id: 'p2', name: 'Ралф docs' },
    ],
  });
  await h.service.startFromMessage(111, 500, '+Ралф Обнови билд');
  const draftId = [...h.drafts.keys()][0]!;
  // Первая карточка — пикер проектов (2 варианта). Выбираем idx=1 (Ралф docs).
  await h.service.handleCallback(cq(`tp:${draftId}:1`));
  // Теперь это confirm — жмём Создать.
  await h.service.handleCallback(cq(`tc:${draftId}`));
  assert.equal(h.createTaskCalls.length, 1);
  assert.equal(h.createTaskCalls[0]!.projectId, 'p2');
});

test('+Проект текст @ответственный → задача сразу в проекте, ответственному карточка действий', async () => {
  const h = makeHarness();
  await h.service.startFromMessage(111, 500, '+Альфа Обнови билд @Вася');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`tc:${draftId}`));
  assert.equal(h.createTaskCalls[0]!.projectId, 'p1'); // сразу в проект, без переноса-на-accept
  assert.equal(h.createTaskCalls[0]!.assigneeUserId, 'u2');
  assert.equal(h.assigneeMessages.length, 1);
  assert.equal(h.assigneeMessages[0]!.userId, 'u2');
  assert.equal(h.assigneeMessages[0]!.kind, 'task_assignee_changed');
  // Кнопки действий по задаче, НЕ «Принять/Отказать».
  assert.ok(h.assigneeMessages[0]!.buttons.includes('nd:t1'));
  assert.ok(h.assigneeMessages[0]!.buttons.includes('nc:t1'));
  assert.ok(!h.assigneeMessages[0]!.buttons.includes('da:'));
  // Эррата #6: обязательна url-кнопка «Открыть в ProjectsFlow» (регрессия «кнопку убрали»).
  assert.ok(h.assigneeMessages[0]!.buttons.includes('Открыть в ProjectsFlow'));
  const d = h.drafts.get(draftId)!;
  assert.equal(d.status, 'confirmed');
  assert.equal(d.assigneeUserId, 'u2');
});

test('+многословный проект → жадный матч имени, остаток = текст', async () => {
  const h = makeHarness({ projects: [{ id: 'p1', name: 'Ралф core' }] });
  await h.service.startFromMessage(111, 500, '+Ралф core Обнови билд');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`tc:${draftId}`));
  assert.equal(h.createTaskCalls[0]!.projectId, 'p1');
  assert.equal(h.createTaskCalls[0]!.description, 'Обнови билд');
});

test('легаси da:/dd: (старые кнопки в чатах) → молчаливый ack, без действий', async () => {
  const h = makeHarness();
  await h.service.handleCallback(cq('da:del1', 222));
  await h.service.handleCallback(cq('dd:del1', 222));
  assert.equal(h.createTaskCalls.length, 0);
  assert.equal(h.edits.length, 0);
  assert.equal(h.answers.length, 2); // оба коллбэка «отвечены», кнопка просто гаснет
});

test('чужой пользователь не может трогать чужой черновик', async () => {
  const h = makeHarness();
  await h.service.startFromMessage(111, 500, '+Альфа задача');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`tc:${draftId}`, 222)); // не создатель
  assert.equal(h.createTaskCalls.length, 0);
});

test('истёкший/неизвестный черновик → алерт, без создания', async () => {
  const h = makeHarness();
  await h.service.handleCallback(cq('tc:nope'));
  assert.equal(h.createTaskCalls.length, 0);
});

// ===================== AI-перефраз (compose) =====================

test('AI: 1 сегмент → одиночная карточка; Создать → задача с дедлайном', async () => {
  const h = makeHarness({
    projects: [{ id: 'p1', name: 'Альфа' }],
    aiSegments: [
      {
        id: 's1',
        title: 'Обновить билд',
        simpleBody: 'Собрать и выложить новый билд.',
        projectId: 'p1',
        projectName: 'Альфа',
        confidence: 0.9,
        assigneeUserId: null,
        assigneeName: null,
        deadline: '2026-06-09',
      },
    ],
  });
  await h.service.startFromMessage(111, 500, 'надо собрать билд');
  // Первое сообщение — «Ожидайте…», карточка приходит редактированием.
  assert.equal(h.sent.length, 1);
  assert.ok(h.sent[0]!.text.includes('Ожидайте'));
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`ac:${draftId}`));
  assert.equal(h.createTaskCalls.length, 1);
  assert.equal(h.createTaskCalls[0]!.projectId, 'p1');
  assert.match(h.createTaskCalls[0]!.description, /Обновить билд/);
  assert.equal(h.createTaskCalls[0]!.deadline, '2026-06-09');
});

test('AI: N сегментов → сводная карточка; исключить сегмент → Создать все создаёт только включённые', async () => {
  const h = makeHarness({
    projects: [
      { id: 'p1', name: 'Альфа' },
      { id: 'p2', name: 'Бета' },
    ],
    aiSegments: [
      {
        id: 's1',
        title: 'Задача один',
        simpleBody: 'Тело один',
        projectId: 'p1',
        projectName: 'Альфа',
        confidence: 0.8,
        assigneeUserId: null,
        assigneeName: null,
        deadline: null,
      },
      {
        id: 's2',
        title: 'Задача два',
        simpleBody: 'Тело два',
        projectId: 'p2',
        projectName: 'Бета',
        confidence: 0.8,
        assigneeUserId: null,
        assigneeName: null,
        deadline: null,
      },
    ],
  });
  await h.service.startFromMessage(111, 500, 'сделать раз и сделать два');
  const draftId = [...h.drafts.keys()][0]!;
  // Исключаем сегмент 2 (idx=1).
  await h.service.handleCallback(cq(`at:${draftId}:1`));
  await h.service.handleCallback(cq(`ac:${draftId}`));
  assert.equal(h.createTaskCalls.length, 1);
  assert.equal(h.createTaskCalls[0]!.projectId, 'p1');
});

test('AI: правка проекта сегмента кнопкой → создаётся в выбранном проекте', async () => {
  const h = makeHarness({
    projects: [
      { id: 'p1', name: 'Альфа' },
      { id: 'p2', name: 'Бета' },
    ],
    aiSegments: [
      {
        id: 's1',
        title: 'Задача',
        simpleBody: 'Тело',
        projectId: 'p1',
        projectName: 'Альфа',
        confidence: 0.5,
        assigneeUserId: null,
        assigneeName: null,
        deadline: null,
      },
    ],
  });
  await h.service.startFromMessage(111, 500, 'что-то сделать');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`ae:${draftId}:0`)); // открыть правку сегмента
  await h.service.handleCallback(cq(`ap:${draftId}:0:?`)); // открыть пикер проектов
  await h.service.handleCallback(cq(`ap:${draftId}:0:1`)); // выбрать Бета (idx=1)
  await h.service.handleCallback(cq(`ac:${draftId}`));
  assert.equal(h.createTaskCalls.length, 1);
  assert.equal(h.createTaskCalls[0]!.projectId, 'p2');
});

test('AI: сегмент с ответственным → задача в проекте + уведомление с кнопками', async () => {
  const h = makeHarness({
    projects: [{ id: 'p1', name: 'Альфа' }],
    shared: [{ id: 'u2', displayName: 'Вася', email: 'v@e.com' }],
    aiSegments: [
      {
        id: 's1',
        title: 'Задача',
        simpleBody: 'Тело',
        projectId: 'p1',
        projectName: 'Альфа',
        confidence: 0.9,
        assigneeUserId: 'u2',
        assigneeName: 'Вася',
        deadline: null,
      },
    ],
  });
  await h.service.startFromMessage(111, 500, 'вася сделай это');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`ac:${draftId}`));
  assert.equal(h.createTaskCalls.length, 1);
  assert.equal(h.createTaskCalls[0]!.projectId, 'p1'); // в проекте, не в inbox
  assert.equal(h.createTaskCalls[0]!.assigneeUserId, 'u2');
  assert.equal(h.assigneeMessages.length, 1);
  assert.ok(h.assigneeMessages[0]!.buttons.includes('nd:t1'));
  assert.ok(!h.assigneeMessages[0]!.buttons.includes('da:'));
  // Эррата #6: обязательна url-кнопка «Открыть в ProjectsFlow» (регрессия «кнопку убрали»).
  assert.ok(h.assigneeMessages[0]!.buttons.includes('Открыть в ProjectsFlow'));
});

test('AI: таймаут → откат на ручной флоу (создаёт как есть)', async () => {
  const h = makeHarness({ projects: [{ id: 'p1', name: 'Альфа' }], aiOutcome: 'timeout' });
  await h.service.startFromMessage(111, 500, '+Альфа Обнови билд');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`tc:${draftId}`)); // ручная карточка → tc
  assert.equal(h.createTaskCalls.length, 1);
  assert.equal(h.createTaskCalls[0]!.projectId, 'p1');
  assert.equal(h.createTaskCalls[0]!.description, 'Обнови билд'); // без перефраза
});

test('AI: битый JSON → откат на ручной флоу (во «Входящие»)', async () => {
  const h = makeHarness({ aiOutcome: 'bad' });
  await h.service.startFromMessage(111, 500, 'купить кофе');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`tc:${draftId}`));
  assert.equal(h.createTaskCalls.length, 1);
  assert.equal(h.createTaskCalls[0]!.projectId, 'inbox1');
});

test('AI: job failed → откат на ручной флоу', async () => {
  const h = makeHarness({ aiOutcome: 'fail' });
  await h.service.startFromMessage(111, 500, 'починить кран');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`tc:${draftId}`));
  assert.equal(h.createTaskCalls.length, 1);
  assert.equal(h.createTaskCalls[0]!.projectId, 'inbox1');
});

// ===================== Выбор колонки (статуса) =====================

const seg1 = (over: Partial<AiSeg> = {}): AiSeg => ({
  id: 's1',
  title: 'Задача',
  simpleBody: 'Тело',
  projectId: 'p1',
  projectName: 'Альфа',
  confidence: 0.9,
  assigneeUserId: null,
  assigneeName: null,
  deadline: null,
  ...over,
});

test('Колонка: дефолт по умолчанию — backlog (AI)', async () => {
  const h = makeHarness({ projects: [{ id: 'p1', name: 'Альфа' }], aiSegments: [seg1()] });
  await h.service.startFromMessage(111, 500, 'сделать дело');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`ac:${draftId}`));
  assert.equal(h.createTaskCalls[0]!.status, 'backlog');
});

test('Колонка: AI — выбор «ВОРКЕР» (todo) кнопкой → создаётся в todo', async () => {
  const h = makeHarness({ projects: [{ id: 'p1', name: 'Альфа' }], aiSegments: [seg1()] });
  await h.service.startFromMessage(111, 500, 'сделать дело');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`as:${draftId}:0:t`)); // pick todo
  await h.service.handleCallback(cq(`ac:${draftId}`));
  assert.equal(h.createTaskCalls[0]!.status, 'todo');
});

test('Колонка: пикер показывает кастомные имена проекта и прячет скрытые', async () => {
  const h = makeHarness({
    projects: [{ id: 'p1', name: 'Альфа' }],
    aiSegments: [seg1()],
    kanbanByProject: { p1: { todo: { label: 'РАБОТА' }, manual: { hidden: true } } },
  });
  await h.service.startFromMessage(111, 500, 'сделать дело');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`as:${draftId}:0:?`)); // открыть пикер
  const picker = h.edits[h.edits.length - 1]!;
  const labels = buttonTexts(picker.replyMarkup);
  assert.ok(labels.includes('РАБОТА'), `кастомная подпись todo: ${labels.join(',')}`);
  assert.ok(labels.includes('ЧЕРНОВИКИ'), 'backlog дефолт');
  assert.ok(labels.includes('Готово'), 'done дефолт');
  assert.ok(!labels.includes('В РУЧНУЮ'), 'manual скрыт → нет в пикере');
});

test('Колонка: выбранное кастомное имя отражается в карточке сегмента', async () => {
  const h = makeHarness({
    projects: [{ id: 'p1', name: 'Альфа' }],
    aiSegments: [seg1()],
    kanbanByProject: { p1: { todo: { label: 'РАБОТА' } } },
  });
  await h.service.startFromMessage(111, 500, 'сделать дело');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`as:${draftId}:0:t`)); // pick todo → карточка правки
  const card = h.edits[h.edits.length - 1]!;
  assert.match(card.text, /Колонка:.*РАБОТА/s);
});

test('Колонка: ручной флоу — дефолт backlog, затем выбор todo', async () => {
  const h = makeHarness({ projects: [{ id: 'p1', name: 'Альфа' }], aiOutcome: 'timeout' });
  await h.service.startFromMessage(111, 500, '+Альфа Обнови билд');
  const draftId = [...h.drafts.keys()][0]!;
  // Дефолт — backlog (без выбора): проверим через отдельный прогон ниже; здесь выбираем todo.
  await h.service.handleCallback(cq(`ts:${draftId}:?`)); // открыть пикер
  await h.service.handleCallback(cq(`ts:${draftId}:t`)); // выбрать ВОРКЕР
  await h.service.handleCallback(cq(`tc:${draftId}`));
  assert.equal(h.createTaskCalls[0]!.status, 'todo');
});

test('Колонка: ручной флоу без выбора → backlog', async () => {
  const h = makeHarness({ projects: [{ id: 'p1', name: 'Альфа' }], aiOutcome: 'timeout' });
  await h.service.startFromMessage(111, 500, '+Альфа Обнови билд');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`tc:${draftId}`));
  assert.equal(h.createTaskCalls[0]!.status, 'backlog');
});

test('Колонка: многосегментная карточка показывает колонку каждой задачи', async () => {
  const h = makeHarness({
    projects: [{ id: 'p1', name: 'Альфа' }, { id: 'p2', name: 'Бета' }],
    aiSegments: [
      seg1({ id: 's1', projectId: 'p1', projectName: 'Альфа' }),
      seg1({ id: 's2', projectId: 'p2', projectName: 'Бета' }),
    ],
  });
  await h.service.startFromMessage(111, 500, 'раз и два');
  // Сводная карточка — это edit поверх «Ожидайте». Колонка дефолт ЧЕРНОВИКИ у обоих.
  const card = h.edits[h.edits.length - 1]!;
  assert.match(card.text, /ЧЕРНОВИКИ/);
});

test('черновик автоматически создаётся после дедлайна ровно один раз', async () => {
  const h = makeHarness({ aiOutcome: 'timeout' });
  await h.service.startFromMessage(111, 500, 'автоматическая задача');
  const draftId = [...h.drafts.keys()][0]!;
  const draft = h.drafts.get(draftId)!;
  h.drafts.set(draftId, { ...draft, autoCreateAt: new Date(Date.now() - 1_000) });

  assert.equal(await h.service.processDueAutoCreate(), 1);
  assert.equal(await h.service.processDueAutoCreate(), 0);
  assert.equal(h.createTaskCalls.length, 1);
  assert.equal(h.drafts.get(draftId)!.status, 'confirmed');
  assert.match(h.edits[h.edits.length - 1]!.text, /автоматически через 10 минут/);
});

test('Telegram-фото прикрепляется и вставляется отдельным figure-блоком', async () => {
  const h = makeHarness({ aiOutcome: 'timeout' });
  await h.service.startFromMessage(111, 500, 'задача со скрином', undefined, [
    { fileId: 'photo-1', fileUniqueId: 'unique-1', width: 1280, height: 720, fileSize: 42 },
  ]);
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`tc:${draftId}`));

  assert.equal(h.updatedDescriptions.length, 1);
  assert.match(
    h.updatedDescriptions[0]!,
    /задача со скрином\n\n<figure data-figure-image><img src="\/api\/attachments\/att1"/,
  );
});
