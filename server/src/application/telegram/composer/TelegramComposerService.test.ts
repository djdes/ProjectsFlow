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
  allowInboxDelegation?: boolean;
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
  aiGate?: Promise<void>;
  // Per-project kanban settings (кастомные подписи/скрытость колонок) для пикера.
  kanbanByProject?: Record<string, any>;
  // Telegram @username → userId. В TG людей упоминают именно так, и модель повторяет за текстом.
  telegramUsernames?: Record<string, string>;
  // Фиксированные часы: «конец недели» иначе плавал бы по дню прогона тестов.
  now?: () => Date;
}) {
  const projects = opts?.projects ?? [{ id: 'p1', name: 'Альфа' }];
  const shared = opts?.shared ?? [{ id: 'u2', displayName: 'Вася', email: 'v@e.com' }];
  const aiSegments = opts?.aiSegments;
  const aiOutcome = opts?.aiOutcome ?? (aiSegments ? undefined : 'enqueue-throw');
  const kanbanByProject = opts?.kanbanByProject ?? {};
  const telegramUsernames = opts?.telegramUsernames ?? {};

  const drafts = new Map<string, TelegramTaskDraft>();
  let seq = 0;
  const createTaskCalls: CreateTaskCall[] = [];
  const sent: { chatId: number; text: string }[] = [];
  const edits: { messageId: number; text: string; replyMarkup?: any }[] = [];
  const answers: { text?: string }[] = [];
  const assigneeMessages: { userId: string; buttons: string; kind: string }[] = [];
  const inboxUserIds: string[] = [];
  const updatedDescriptions: string[] = [];
  const downloadedFileIds: string[] = [];
  const uploadedAttachments: {
    taskId: string;
    filename: string;
    mimeType: string;
  }[] = [];

  const draftsRepo = {
    async create(input: any): Promise<TelegramTaskDraft> {
      if (input.sourceKey) {
        const existing = [...drafts.values()].find((draft) => draft.sourceKey === input.sourceKey);
        if (existing) return existing;
      }
      const id = input.id;
      const d: TelegramTaskDraft = {
        id,
        creatorUserId: input.creatorUserId,
        tgChatId: input.tgChatId,
        tgMessageId: input.tgMessageId ?? null,
        sourceKey: input.sourceKey ?? null,
        taskText: input.taskText,
        projectId: input.projectId ?? null,
        assigneeUserId: input.assigneeUserId ?? null,
        offered: input.offered ?? null,
        segments: input.segments ?? null,
        photos: input.photos ?? [],
        attachments: input.attachments ?? [],
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
    async findBySourceKey(sourceKey: string) {
      return [...drafts.values()].find((draft) => draft.sourceKey === sourceKey) ?? null;
    },
    async patch(id: string, patch: any) {
      const cur = drafts.get(id);
      if (!cur) return null;
      const next = { ...cur, ...patch } as TelegramTaskDraft;
      drafts.set(id, next);
      return next;
    },
    async patchComposing(id: string, patch: any) {
      const cur = drafts.get(id);
      if (!cur || cur.status !== 'composing') return null;
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
    async downloadFile(fileId: string) {
      downloadedFileIds.push(fileId);
      return {
        data: Buffer.from(fileId),
        filename: `${fileId}.bin`,
        mimeType: 'application/octet-stream',
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
      // Регистронезависимо и без ведущего @ — как в настоящем DrizzleUserRepository.
      async findUserIdByTelegramUsername(username: string) {
        const clean = username.trim().replace(/^@/, '').toLowerCase();
        return telegramUsernames[clean] ?? null;
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
          allowInboxDelegation: input.allowInboxDelegation ?? false,
        });
        return {
          id: `t${createTaskCalls.length}`,
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
        // Инбокс у каждого юзера свой: 'inbox1' у u1 (создатель в тестах), 'inbox-<id>' у прочих.
        const id = !userId || userId === 'u1' ? 'inbox1' : `inbox-${userId}`;
        return { id, name: 'Входящие', isInbox: true } as any;
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
        await opts?.aiGate;
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
      async execute(input: any) {
        uploadedAttachments.push({
          taskId: input.taskId,
          filename: input.filename,
          mimeType: input.mimeType,
        });
        return { id: `att${uploadedAttachments.length}` } as any;
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
    ...(opts?.now ? { now: opts.now } : {}),
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
    downloadedFileIds,
    uploadedAttachments,
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

test('группа: повтор update непривязанного отправителя не дублирует задачу владельца', async () => {
  const h = makeHarness();
  const options = { sourceKey: 'm:-100:77' } as const;

  await h.service.startFromMessage(999, 500, 'подготовить отчёт', gctx('u1', 'Гость'), [], options);
  await h.service.startFromMessage(999, 500, 'подготовить отчёт', gctx('u1', 'Гость'), [], options);

  assert.equal(h.createTaskCalls.length, 1);
  assert.equal(h.drafts.size, 1);
  assert.equal([...h.drafts.values()][0]!.status, 'confirmed');
});

test('группа: непривязанный + группа без владельца → подсказка про /start, ничего не создаём', async () => {
  const h = makeHarness();
  await h.service.startFromMessage(999, 500, 'что-то сделать', gctx(null, 'Гость'));
  assert.equal(h.createTaskCalls.length, 0);
  assert.equal(h.drafts.size, 0);
  assert.ok(h.sent.length >= 1);
  assert.ok(h.sent[0]!.text.includes('/start'));
});

test('повтор одного Telegram update не создаёт второй черновик и карточку', async () => {
  const h = makeHarness({
    aiSegments: [
      {
        id: 's1',
        title: 'Одна задача',
        simpleBody: 'Тело',
        projectId: 'p1',
        projectName: 'Альфа',
        confidence: 0.9,
        assigneeUserId: null,
        assigneeName: null,
        deadline: null,
      },
    ],
  });
  const options = { sourceKey: 'm:500:42' } as const;

  await h.service.startFromMessage(111, 500, 'одна задача', undefined, [], options);
  const sentAfterFirstDelivery = h.sent.length;
  const editsAfterFirstDelivery = h.edits.length;
  await h.service.startFromMessage(111, 500, 'одна задача', undefined, [], options);

  assert.equal(h.drafts.size, 1);
  assert.equal([...h.drafts.values()][0]!.sourceKey, 'm:500:42');
  assert.equal(h.sent.length, sentAfterFirstDelivery);
  assert.equal(h.edits.length, editsAfterFirstDelivery);
});

test('поздняя часть Telegram-альбома добавляется в тот же черновик, а не теряется', async () => {
  const h = makeHarness({ aiSegments: [
    {
      id: 's1',
      title: 'Проверить альбом',
      simpleBody: 'Проверить все материалы.',
      projectId: 'p1',
      projectName: 'Альфа',
      confidence: 0.9,
      assigneeUserId: null,
      assigneeName: null,
      deadline: null,
    },
  ] });
  const attachment = (key: string) => ({
    key,
    kind: 'document' as const,
    fileId: `${key}-id`,
    fileUniqueId: key,
    filename: `${key}.pdf`,
    mimeType: 'application/pdf',
    width: null,
    height: null,
    duration: null,
    fileSize: 10,
    targetSegmentIndexes: [] as number[],
  });
  const options = { sourceKey: 'g:500:111:album-split' } as const;

  await h.service.startFromMessage(111, 500, 'проверить альбом', undefined, [attachment('one')], options);
  await h.service.startFromMessage(111, 500, 'проверить альбом', undefined, [attachment('two')], options);
  // Повтор первой части не должен снова добавить тот же Telegram file_unique_id.
  await h.service.startFromMessage(111, 500, 'проверить альбом', undefined, [attachment('one')], options);

  const draft = [...h.drafts.values()][0]!;
  assert.deepEqual(draft.attachments.map((item) => item.filename), ['one.pdf', 'two.pdf']);
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

// Реальный случай с прода: модель вернула ИМЯ ответственного и не вернула его id
// ({"assigneeUserId":null,"assigneeName":"Вася"}). Карточка показывала имя, а задача уезжала
// на автора — пользователь был уверен, что делегировал.
test('AI: имя ответственного без id → сопоставляется с участником, а не падает на автора', async () => {
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
        assigneeUserId: null,
        assigneeName: 'Вася',
        deadline: null,
      },
    ],
  });
  await h.service.startFromMessage(111, 500, 'вася сделай это');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`ac:${draftId}`));

  assert.equal(h.createTaskCalls.length, 1);
  assert.equal(h.createTaskCalls[0]!.assigneeUserId, 'u2');
  assert.equal(h.assigneeMessages.length, 1); // ответственному ушло уведомление
});

// Явное @упоминание в тексте задачи. Раньше этот путь резолвил ТОЛЬКО по отображаемому имени,
// поэтому «@hotspotping сделай» не находил никого, хотя у пользователя привязан ровно один TG.
test('явное @упоминание резолвится по Telegram @username', async () => {
  const h = makeHarness({
    projects: [{ id: 'p1', name: 'Альфа' }],
    shared: [{ id: 'u2', displayName: 'Вася', email: 'v@e.com' }],
    telegramUsernames: { hotspotping: 'u2' },
    aiOutcome: 'enqueue-throw', // без AI — ручной путь
  });
  await h.service.startFromMessage(111, 500, '+Альфа Обнови билд @hotspotping');
  const draftId = [...h.drafts.keys()][0]!;
  assert.equal(h.drafts.get(draftId)!.assigneeUserId, 'u2');
});

// Срок по умолчанию: без него CreateTask ставит «сегодня», и задача из чата сразу просрочена.
test('без явного срока сегменту ставится конец недели (пятница)', async () => {
  const h = makeHarness({
    projects: [{ id: 'p1', name: 'Альфа' }],
    now: () => new Date(2026, 6, 22, 12, 0, 0), // среда, 22.07.2026
    aiSegments: [
      {
        id: 's1',
        title: 'Задача',
        simpleBody: 'Тело',
        projectId: 'p1',
        projectName: 'Альфа',
        confidence: 0.9,
        assigneeUserId: null,
        assigneeName: null,
        deadline: null,
      },
    ],
  });
  await h.service.startFromMessage(111, 500, 'сделать это');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`ac:${draftId}`));
  assert.equal(h.createTaskCalls[0]!.deadline, '2026-07-24');
});

test('явно указанный моделью срок не перебивается', async () => {
  const h = makeHarness({
    projects: [{ id: 'p1', name: 'Альфа' }],
    now: () => new Date(2026, 6, 22, 12, 0, 0),
    aiSegments: [
      {
        id: 's1',
        title: 'Задача',
        simpleBody: 'Тело',
        projectId: 'p1',
        projectName: 'Альфа',
        confidence: 0.9,
        assigneeUserId: null,
        assigneeName: null,
        deadline: '2026-08-15',
      },
    ],
  });
  await h.service.startFromMessage(111, 500, 'сделать это до 15 августа');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`ac:${draftId}`));
  assert.equal(h.createTaskCalls[0]!.deadline, '2026-08-15');
});

// Ровно тот случай, что был в проде: модель вернула Telegram @username («hotspotping»),
// а по отображаемому имени такой не находится в принципе — нужен резолв по username.
test('AI: ответственный по Telegram @username сопоставляется с участником', async () => {
  const h = makeHarness({
    projects: [{ id: 'p1', name: 'Альфа' }],
    shared: [{ id: 'u2', displayName: 'Вася', email: 'v@e.com' }],
    telegramUsernames: { hotspotping: 'u2' },
    aiSegments: [
      {
        id: 's1',
        title: 'Задача',
        simpleBody: 'Тело',
        projectId: 'p1',
        projectName: 'Альфа',
        confidence: 0.9,
        assigneeUserId: null,
        assigneeName: 'hotspotping',
        deadline: null,
      },
    ],
  });
  await h.service.startFromMessage(111, 500, '@hotspotping сделай это');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`ac:${draftId}`));

  assert.equal(h.createTaskCalls.length, 1);
  assert.equal(h.createTaskCalls[0]!.assigneeUserId, 'u2');
});

// Username есть в базе, но человек не участник проекта — назначать его нельзя (CreateTask
// такого ассайни отвергнет и сегмент упадёт). Тихо оставляем автора.
test('AI: @username не-участника не назначается', async () => {
  const h = makeHarness({
    projects: [{ id: 'p1', name: 'Альфа' }],
    shared: [{ id: 'u2', displayName: 'Вася', email: 'v@e.com' }],
    telegramUsernames: { stranger: 'u9' },
    aiSegments: [
      {
        id: 's1',
        title: 'Задача',
        simpleBody: 'Тело',
        projectId: 'p1',
        projectName: 'Альфа',
        confidence: 0.9,
        assigneeUserId: null,
        assigneeName: 'stranger',
        deadline: null,
      },
    ],
  });
  await h.service.startFromMessage(111, 500, 'сделать это');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`ac:${draftId}`));

  assert.equal(h.createTaskCalls.length, 1);
  assert.equal(h.createTaskCalls[0]!.assigneeUserId, 'u1');
});

// Обратная сторона: имя, которое ни с кем не сматчилось, НЕ должно выглядеть как назначение.
// Иначе карточка снова обещает одно, а задача делает другое.
test('AI: неопознанное имя → ответственным остаётся автор, и карточка не показывает чужое имя', async () => {
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
        assigneeUserId: null,
        assigneeName: 'hotspotping',
        deadline: null,
      },
    ],
  });
  await h.service.startFromMessage(111, 500, 'сделать это');
  const draftId = [...h.drafts.keys()][0]!;
  const card = h.sent.map((m) => m.text).join('\n');
  assert.ok(!card.includes('hotspotping'), `карточка не должна обещать неопознанного ответственного:\n${card}`);

  await h.service.handleCallback(cq(`ac:${draftId}`));
  assert.equal(h.createTaskCalls.length, 1);
  assert.equal(h.createTaskCalls[0]!.assigneeUserId, 'u1'); // автор — и карточка это показала
  assert.equal(h.assigneeMessages.length, 0); // делегирования не было → уведомлять некого
});

test('AI: сегмент без проекта, но с ответственным → во «Входящие» ОТВЕТСТВЕННОГО', async () => {
  const h = makeHarness({
    projects: [{ id: 'p1', name: 'Альфа' }],
    shared: [{ id: 'u2', displayName: 'Олег', email: 'o@e.com' }],
    aiSegments: [
      {
        id: 's1',
        title: 'Сервис HTTP API для 1С',
        simpleBody: 'Сделать до конца месяца.',
        projectId: null,
        projectName: null,
        confidence: 0.9,
        assigneeUserId: 'u2',
        assigneeName: 'Олег',
        deadline: null,
      },
    ],
  });
  await h.service.startFromMessage(111, 500, 'для олега до конца месяца сделать http api для 1с');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`ac:${draftId}`));

  assert.equal(h.createTaskCalls.length, 1);
  assert.equal(h.createTaskCalls[0]!.projectId, 'inbox-u2'); // инбокс Олега, НЕ создателя
  assert.equal(h.createTaskCalls[0]!.ownerUserId, 'u1'); // автор — создатель
  assert.equal(h.createTaskCalls[0]!.assigneeUserId, 'u2');
  assert.equal(h.createTaskCalls[0]!.allowInboxDelegation, true);
  assert.deepEqual(h.inboxUserIds, ['u2']);
  assert.equal(h.assigneeMessages.length, 1); // ответственному уходит карточка
});

test('AI: сегмент без проекта и без ответственного → инбокс создателя (регрессия)', async () => {
  const h = makeHarness({
    projects: [{ id: 'p1', name: 'Альфа' }],
    aiSegments: [
      {
        id: 's1',
        title: 'Разобрать почту',
        simpleBody: 'Тело',
        projectId: null,
        projectName: null,
        confidence: 0.9,
        assigneeUserId: null,
        assigneeName: null,
        deadline: null,
      },
    ],
  });
  await h.service.startFromMessage(111, 500, 'разобрать почту');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`ac:${draftId}`));

  assert.equal(h.createTaskCalls.length, 1);
  assert.equal(h.createTaskCalls[0]!.projectId, 'inbox1');
  assert.equal(h.createTaskCalls[0]!.assigneeUserId, 'u1');
  assert.equal(h.createTaskCalls[0]!.allowInboxDelegation, false);
  assert.deepEqual(h.inboxUserIds, ['u1']);
});

test('ручной флоу: @ответственный без проекта → во «Входящие» ответственного', async () => {
  const h = makeHarness({ shared: [{ id: 'u2', displayName: 'Вася', email: 'v@e.com' }] });
  await h.service.startFromMessage(111, 500, 'починить отчёт @Вася');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`tc:${draftId}`));

  assert.equal(h.createTaskCalls.length, 1);
  assert.equal(h.createTaskCalls[0]!.projectId, 'inbox-u2');
  assert.equal(h.createTaskCalls[0]!.ownerUserId, 'u1');
  assert.equal(h.createTaskCalls[0]!.assigneeUserId, 'u2');
  assert.equal(h.createTaskCalls[0]!.allowInboxDelegation, true);
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

test('auto-create выигрывает у долгого AI без перезаписи результата и сохраняет @ответственного', async () => {
  let releaseAi!: () => void;
  const aiGate = new Promise<void>((resolve) => {
    releaseAi = resolve;
  });
  const h = makeHarness({ aiGate, aiSegments: [seg1()] });

  await h.service.startFromMessage(
    111,
    500,
    'Починить отчёт @Вася',
    undefined,
    [],
    { sourceKey: 'm:500:long-ai', background: true },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  const draftId = [...h.drafts.keys()][0]!;
  const draft = h.drafts.get(draftId)!;
  h.drafts.set(draftId, { ...draft, autoCreateAt: new Date(Date.now() - 1_000) });

  assert.equal(await h.service.processDueAutoCreate(), 1);
  assert.equal(h.createTaskCalls.length, 1);
  assert.equal(h.createTaskCalls[0]!.description, 'Починить отчёт');
  assert.equal(h.createTaskCalls[0]!.assigneeUserId, 'u2');
  assert.doesNotMatch(h.createTaskCalls[0]!.description, /Ответственный:/);
  const finalText = h.edits[h.edits.length - 1]!.text;
  assert.match(finalText, /автоматически через 10 минут/);

  releaseAi();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(h.createTaskCalls.length, 1);
  assert.equal(h.edits[h.edits.length - 1]!.text, finalText, 'AI must not replace the final card');
});

test('Telegram-фото прикрепляется и вставляется отдельным figure-блоком', async () => {
  const h = makeHarness({ aiOutcome: 'timeout' });
  await h.service.startFromMessage(111, 500, 'задача со скрином', undefined, [
    {
      key: 'unique-1',
      kind: 'photo',
      fileId: 'photo-1',
      fileUniqueId: 'unique-1',
      filename: 'screen.jpg',
      mimeType: 'image/jpeg',
      width: 1280,
      height: 720,
      duration: null,
      fileSize: 42,
      targetSegmentIndexes: [],
    },
  ]);
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`tc:${draftId}`));

  assert.equal(h.updatedDescriptions.length, 1);
  assert.match(
    h.updatedDescriptions[0]!,
    /задача со скрином\n\n<figure data-figure-image><img src="\/api\/attachments\/att1"/,
  );
});

test('5 задач и 2 файла: каждый файл назначается произвольному набору задач', async () => {
  const h = makeHarness({
    projects: [{ id: 'p1', name: 'Альфа' }],
    aiSegments: Array.from({ length: 5 }, (_, index) =>
      seg1({
        id: `s${index + 1}`,
        title: `Задача ${index + 1}`,
        simpleBody: `Тело ${index + 1}`,
      }),
    ),
  });
  const files = [
    {
      key: 'file-1-unique',
      kind: 'document' as const,
      fileId: 'file-1',
      fileUniqueId: 'file-1-unique',
      filename: 'first.pdf',
      mimeType: 'application/pdf',
      width: null,
      height: null,
      duration: null,
      fileSize: 101,
      targetSegmentIndexes: [],
    },
    {
      key: 'file-2-unique',
      kind: 'document' as const,
      fileId: 'file-2',
      fileUniqueId: 'file-2-unique',
      filename: 'second.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      width: null,
      height: null,
      duration: null,
      fileSize: 202,
      targetSegmentIndexes: [],
    },
  ];

  await h.service.startFromMessage(111, 500, 'сделать пять задач', undefined, files);
  const draftId = [...h.drafts.keys()][0]!;

  await h.service.handleCallback(cq(`fs:${draftId}:0:p0`));
  const picker = h.edits[h.edits.length - 1]!;
  assert.match(picker.text, /К каким задачам прикрепить/);
  const pickerButtons = picker.replyMarkup.inline_keyboard.flat();
  assert.ok(pickerButtons.some((button: any) => button.text === '🔗 Ко всем'));
  assert.ok(!pickerButtons.some((button: any) => button.text === '✅ Ко всем'));
  for (const row of picker.replyMarkup.inline_keyboard) {
    for (const button of row) {
      if (button.callback_data) assert.ok(Buffer.byteLength(button.callback_data, 'utf8') <= 64);
    }
  }

  // По умолчанию каждый файл назначен первой задаче. Первый оставляем в первой и
  // добавляем ко второй и пятой: 1, 2, 5.
  await h.service.handleCallback(cq(`fx:${draftId}:0:1:p0`));
  await h.service.handleCallback(cq(`fx:${draftId}:0:4:p0`));

  // Второй очищаем и назначаем второй и третьей: 2, 3.
  await h.service.handleCallback(cq(`fg:${draftId}:1:n:p0`));
  await h.service.handleCallback(cq(`fx:${draftId}:1:1:p0`));
  await h.service.handleCallback(cq(`fx:${draftId}:1:2:p0`));
  await h.service.handleCallback(cq(`fd:${draftId}`));
  await h.service.handleCallback(cq(`ac:${draftId}`));

  assert.equal(h.createTaskCalls.length, 5);
  assert.deepEqual(
    h.uploadedAttachments.map(({ taskId, filename }) => `${taskId}:${filename}`),
    [
      't1:first.pdf',
      't2:first.pdf',
      't2:second.xlsx',
      't3:second.xlsx',
      't5:first.pdf',
    ],
  );
  assert.deepEqual(h.downloadedFileIds.sort(), ['file-1', 'file-2']);
  assert.match(h.edits[h.edits.length - 1]!.text, /Вложений прикреплено: 5/);
});

test('быстрые параллельные нажатия распределения не затирают выбор другого файла', async () => {
  const h = makeHarness({
    aiSegments: [
      seg1({ id: 's1', title: 'Первая' }),
      seg1({ id: 's2', title: 'Вторая' }),
    ],
  });
  const files = ['one', 'two'].map((key) => ({
    key,
    kind: 'document' as const,
    fileId: `${key}-id`,
    fileUniqueId: key,
    filename: `${key}.pdf`,
    mimeType: 'application/pdf',
    width: null,
    height: null,
    duration: null,
    fileSize: 10,
    targetSegmentIndexes: [] as number[],
  }));
  await h.service.startFromMessage(111, 500, 'две задачи', undefined, files);
  const draftId = [...h.drafts.keys()][0]!;

  await Promise.all([
    h.service.handleCallback(cq(`fx:${draftId}:0:1:p0`)),
    h.service.handleCallback({ ...cq(`fx:${draftId}:1:1:p0`), id: 'cq2' }),
  ]);

  assert.deepEqual(
    h.drafts.get(draftId)!.attachments.map((attachment) => attachment.targetSegmentIndexes),
    [[0, 1], [0, 1]],
  );
});

test('картинка, отправленная документом, остаётся файлом и не дублируется figure-блоком', async () => {
  const h = makeHarness({ aiOutcome: 'timeout' });
  await h.service.startFromMessage(111, 500, 'макет как файл', undefined, [
    {
      key: 'document-image',
      kind: 'document',
      fileId: 'document-image-id',
      fileUniqueId: 'document-image',
      filename: 'original.png',
      mimeType: 'image/png',
      width: null,
      height: null,
      duration: null,
      fileSize: 55,
      targetSegmentIndexes: [],
    },
  ]);
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`tc:${draftId}`));

  assert.deepEqual(h.uploadedAttachments, [
    { taskId: 't1', filename: 'original.png', mimeType: 'image/png' },
  ]);
  assert.equal(h.updatedDescriptions.length, 0);
});
