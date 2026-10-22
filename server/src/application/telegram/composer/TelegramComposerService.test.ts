import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TelegramComposerService, type TelegramCallbackQuery } from './TelegramComposerService.js';
import type { TelegramTaskDraft } from '../TelegramTaskDraftRepository.js';
import type { TelegramTaskOrigin } from '../TelegramTaskOriginRepository.js';
import { WorkerDisabledError } from '../../../domain/workspace/errors.js';
import {
  InsufficientProjectRoleError,
  ProjectNotFoundError,
} from '../../../domain/project/errors.js';

// --- Минимальные in-memory фейки (tsx + node:test, без новых deps). ---

// Patch черновика как в DrizzleTelegramTaskDraftRepository: autoCreateSeconds — не поле, а
// команда «завести таймер через N секунд» (null — выключить).
function applyDraftPatch(cur: TelegramTaskDraft, patch: any): TelegramTaskDraft {
  const { autoCreateSeconds, ...rest } = patch ?? {};
  const next = { ...cur, ...rest } as TelegramTaskDraft;
  if (autoCreateSeconds !== undefined) {
    return {
      ...next,
      autoCreateAt: autoCreateSeconds === null ? null : new Date(Date.now() + autoCreateSeconds * 1000),
    };
  }
  return next;
}

type CreateTaskCall = {
  projectId: string;
  ownerUserId?: string;
  description: string;
  assigneeUserId?: string | null;
  deadline?: string | null;
  status?: string;
  allowInboxDelegation?: boolean;
  taskType?: 'feature' | 'bug' | null;
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
  taskType?: 'feature' | 'bug' | null;
  sourceExcerpt?: string | null;
};

function makeHarness(opts?: {
  workerEnabled?: boolean;
  projects?: { id: string; name: string }[];
  shared?: { id: string; displayName: string; email: string }[];
  aiSegments?: AiSeg[];
  aiOutcome?: 'enqueue-throw' | 'timeout' | 'fail' | 'bad';
  // Текст ошибки упавшего задания (aiOutcome: 'fail') — например, лимит подписки ChatGPT.
  aiError?: string;
  // Сообщения бота, привязанные к задачам: `${chatId}:${messageId}` → задача (taskMessages).
  taskMessageLinks?: Record<string, { taskId: string; projectId: string }>;
  aiGate?: Promise<void>;
  // Per-project kanban settings (кастомные подписи/скрытость колонок) для пикера.
  kanbanByProject?: Record<string, any>;
  // Telegram @username → userId. В TG людей упоминают именно так, и модель повторяет за текстом.
  telegramUsernames?: Record<string, string>;
  // Фиксированные часы: «конец недели» иначе плавал бы по дню прогона тестов.
  now?: () => Date;
  // 'throw' — CreateTaskComment отказывает (нет доступа): проверяем, что задача всё равно создана.
  commentOutcome?: 'throw';
  // Уже существующие задачи (для сегментов-дополнений, B3): taskId → задача.
  existingTasks?: Record<string, any>;
  // Отказ CreateTask: вернуть ошибку — createTask её бросит (нет проекта, сбой БД и т.п.).
  createTaskError?: (input: any) => Error | null;
  // Пространства автора (u1) для выбора, куда класть задачи без проекта. Без опции —
  // прежнее поведение (активное пространство), им идут все «старые» тесты.
  workspaces?: {
    list: { id: string; name: string; icon: string | null; kind: 'default' | 'team' }[];
    // Кто ещё состоит в пространстве (кроме u1, который состоит во всех из list).
    members?: Record<string, string[]>;
    // Пространства, привязанные к Telegram-группе (chatId → id пространств).
    linked?: Record<number, string[]>;
    // Прошлый выбор: `${chatId}:${userId}` → выбор.
    choices?: Record<string, { workspaceId: string; chosenAt: Date }>;
  };
  // Пространство «Входящих» ответственного при делегировании (undefined — зависимость не задана).
  delegatedInboxWorkspace?: string | null;
}) {
  const projects: { id: string; name: string; workspaceId?: string }[] = opts?.projects ?? [
    { id: 'p1', name: 'Альфа' },
  ];
  const shared = opts?.shared ?? [{ id: 'u2', displayName: 'Вася', email: 'v@e.com' }];
  const aiSegments = opts?.aiSegments;
  const aiOutcome = opts?.aiOutcome ?? (aiSegments ? undefined : 'enqueue-throw');
  const kanbanByProject = opts?.kanbanByProject ?? {};
  const telegramUsernames = opts?.telegramUsernames ?? {};
  const commentOutcome = opts?.commentOutcome;
  const existingTasks = opts?.existingTasks ?? {};
  const createTaskError = opts?.createTaskError;

  const drafts = new Map<string, TelegramTaskDraft>();
  const origins: Omit<TelegramTaskOrigin, 'requestedAt'>[] = [];
  let seq = 0;
  const createTaskCalls: CreateTaskCall[] = [];
  const sent: { chatId: number; text: string }[] = [];
  const edits: { messageId: number; text: string; replyMarkup?: any }[] = [];
  const answers: { text?: string }[] = [];
  const assigneeMessages: { userId: string; buttons: string; kind: string }[] = [];
  const inboxUserIds: string[] = [];
  // Вызовы GetOrCreateInbox: владелец, автор и явное пространство (третий аргумент).
  const inboxCalls: { ownerId?: string; actorId?: string; workspaceId?: string }[] = [];
  const delegatedResolverCalls: [string, string][] = [];
  const savedChoices: { chatId: number; userId: string; workspaceId: string }[] = [];
  const workspaceChoices = new Map(Object.entries(opts?.workspaces?.choices ?? {}));
  const updatedDescriptions: string[] = [];
  const downloadedFileIds: string[] = [];
  const uploadedAttachments: {
    taskId: string;
    filename: string;
    mimeType: string;
  }[] = [];
  const comments: {
    taskId: string;
    projectId: string;
    ownerUserId: string;
    body: string;
    actorKind?: string;
    agentName?: string;
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
        awaitingTextSeg: null,
        workspaceId: input.workspaceId ?? null,
        workspacePending: input.workspacePending ?? false,
        replyContext: input.replyContext ?? null,
        status: 'composing',
        createdAt: new Date(),
        autoCreateAt:
          input.autoCreateSeconds == null ? null : new Date(Date.now() + input.autoCreateSeconds * 1000),
        confirmationStartedAt: null,
        expiresAt: new Date(8640000000000000),
        aiStartedAt: null,
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
    // Ждущий новый текст черновик этого автора в этом чате. Живой (composing) — как в SQL.
    async findAwaitingText(creatorUserId: string, tgChatId: number) {
      return (
        [...drafts.values()]
          .filter(
            (d) =>
              d.creatorUserId === creatorUserId &&
              d.tgChatId === tgChatId &&
              d.awaitingTextSeg !== null &&
              d.awaitingTextSeg !== undefined &&
              d.status === 'composing',
          )
          .pop() ?? null
      );
    },
    async patch(id: string, patch: any) {
      const cur = drafts.get(id);
      if (!cur) return null;
      const next = applyDraftPatch(cur, patch);
      drafts.set(id, next);
      return next;
    },
    async patchComposing(id: string, patch: any) {
      const cur = drafts.get(id);
      if (!cur || cur.status !== 'composing') return null;
      const next = applyDraftPatch(cur, patch);
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
    async parkConfirmation(id: string) {
      const cur = drafts.get(id);
      if (!cur || cur.status !== 'confirming') return;
      drafts.set(id, { ...cur, status: 'composing', confirmationStartedAt: null, autoCreateAt: null });
    },
    async cancelConfirmation(id: string) {
      const cur = drafts.get(id);
      if (!cur || cur.status !== 'confirming') return false;
      drafts.set(id, { ...cur, status: 'cancelled', confirmationStartedAt: null, autoCreateAt: null });
      return true;
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
    async listOrphanedAiDrafts(startedBefore: Date, createdAfter: Date) {
      return [...drafts.values()].filter(
        (d) => d.status === 'composing' && d.aiStartedAt && d.aiStartedAt < startedBefore && d.createdAt > createdAfter,
      );
    },
    async claimAiResume(id: string, seenStartedAt: Date, notBeforeSeconds: number) {
      const cur = drafts.get(id);
      if (!cur || cur.status !== 'composing' || cur.aiStartedAt?.getTime() !== seenStartedAt.getTime()) return null;
      const notBefore = new Date(Date.now() + notBeforeSeconds * 1000);
      const next = {
        ...cur,
        aiStartedAt: new Date(),
        autoCreateAt: cur.autoCreateAt && cur.autoCreateAt > notBefore ? cur.autoCreateAt : cur.autoCreateAt ? notBefore : null,
      };
      drafts.set(id, next);
      return next;
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
    workerPolicy: {
      async requireEnabledForProject() { if (opts?.workerEnabled === false) throw new WorkerDisabledError(); },
    },
    taskOrigins: {
      async attach(origin: Omit<TelegramTaskOrigin, 'requestedAt'>) { origins.push(origin); },
    },
    taskMessages: {
      async upsert() {},
      async findByMessage(chatId: number, messageId: number) {
        const link = opts?.taskMessageLinks?.[`${chatId}:${messageId}`];
        return link ? ({ tgChatId: chatId, tgMessageId: messageId, recipientUserId: 'u1', ...link } as any) : null;
      },
    },
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
        const failure = createTaskError?.(input);
        if (failure) throw failure;
        createTaskCalls.push({
          projectId: input.projectId,
          ownerUserId: input.ownerUserId,
          description: input.description,
          assigneeUserId: input.assigneeUserId ?? input.ownerUserId,
          deadline: input.deadline ?? null,
          status: input.status,
          allowInboxDelegation: input.allowInboxDelegation ?? false,
          taskType: input.taskType ?? null,
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
      async execute(userId?: string, actorId?: string, workspaceId?: string) {
        if (userId) inboxUserIds.push(userId);
        inboxCalls.push({ ownerId: userId, actorId, workspaceId });
        // Инбокс у каждого юзера свой: 'inbox1' у u1 (создатель в тестах), 'inbox-<id>' у прочих.
        // В тестах выбора пространства (opts.workspaces) — свой в каждом: 'inbox1@w-team'.
        const base = !userId || userId === 'u1' ? 'inbox1' : `inbox-${userId}`;
        const id = workspaceId && opts?.workspaces ? `${base}@${workspaceId}` : base;
        return { id, name: 'Входящие', isInbox: true, workspaceId } as any;
      },
    },
    ...(opts?.workspaces
      ? {
          workspaces: {
            async listForUser(userId: string) {
              return userId === 'u1' ? opts.workspaces!.list : [];
            },
            async isMember(workspaceId: string, userId: string) {
              if (userId === 'u1') return opts.workspaces!.list.some((w) => w.id === workspaceId);
              return (opts.workspaces!.members?.[workspaceId] ?? []).includes(userId);
            },
            chats: {
              async linkedWorkspaceIds(chatId: number) {
                return opts.workspaces!.linked?.[chatId] ?? [];
              },
              async getChoice(chatId: number, userId: string) {
                return workspaceChoices.get(`${chatId}:${userId}`) ?? null;
              },
              async saveChoice(chatId: number, userId: string, workspaceId: string) {
                savedChoices.push({ chatId, userId, workspaceId });
                workspaceChoices.set(`${chatId}:${userId}`, { workspaceId, chosenAt: new Date() });
              },
            },
          },
        }
      : {}),
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
        if (aiOutcome === 'fail') return { status: 'failed', improvedText: null, error: opts?.aiError ?? null } as any;
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
    tasks: {
      async getById(id: string) {
        return existingTasks[id] ?? null;
      },
    },
    createTaskComment: {
      async execute(input: any) {
        if (commentOutcome === 'throw') throw new Error('нет доступа к задаче (тест)');
        comments.push({
          taskId: input.taskId,
          projectId: input.projectId,
          ownerUserId: input.ownerUserId,
          body: input.body,
          actorKind: input.actorKind,
          agentName: input.agentName,
        });
        return { id: `c${comments.length}` } as any;
      },
    },
    ...(opts?.delegatedInboxWorkspace !== undefined
      ? {
          async resolveDelegatedInboxWorkspace(ownerId: string, actorId: string) {
            delegatedResolverCalls.push([ownerId, actorId]);
            return opts.delegatedInboxWorkspace ?? null;
          },
        }
      : {}),
    idGen: () => 'uuid',
    shortIdGen: () => `s${++seq}`,
    appUrl: 'https://pf.test',
    ...(opts?.now ? { now: opts.now } : {}),
  };

  const service = new TelegramComposerService(deps as any);
  return {
    service,
    origins,
    drafts,
    createTaskCalls,
    sent,
    edits,
    answers,
    assigneeMessages,
    inboxUserIds,
    inboxCalls,
    savedChoices,
    delegatedResolverCalls,
    updatedDescriptions,
    downloadedFileIds,
    uploadedAttachments,
    comments,
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

test('«Готово …» (ручной флоу) → черновик в колонке «Готово»; подтверждение создаёт done', async () => {
  const h = makeHarness({ aiOutcome: 'timeout' }); // AI деградирует → ручной флоу
  await h.service.startFromMessage(111, 500, 'готово починить сборку', undefined, [], {
    sourceKey: 'm:500:1',
  });
  const draftId = [...h.drafts.keys()][0]!;
  const draft = h.drafts.get(draftId)!;
  assert.equal(draft.targetStatus, 'done'); // колонка зафиксирована сразу
  assert.equal(draft.taskText, 'починить сборку'); // ключевое слово срезано
  // Подтверждаем карточку → задача создаётся в «Готово».
  await h.service.handleCallback(cq(`tc:${draftId}`));
  assert.equal(h.createTaskCalls.length, 1);
  assert.equal(h.createTaskCalls[0]!.status, 'done');
  assert.equal(h.createTaskCalls[0]!.description, 'починить сборку');
});

test('«Готово … @Вася» → колонка «Готово» + делегирование во «Входящие» коллеги', async () => {
  const h = makeHarness({ aiOutcome: 'timeout' });
  await h.service.startFromMessage(111, 500, 'готово обновил прод @Вася', undefined, [], {
    sourceKey: 'm:500:2',
  });
  const draftId = [...h.drafts.keys()][0]!;
  const draft = h.drafts.get(draftId)!;
  assert.equal(draft.targetStatus, 'done');
  assert.equal(draft.assigneeUserId, 'u2'); // делегировано Васе
  await h.service.handleCallback(cq(`tc:${draftId}`));
  const c = h.createTaskCalls[0]!;
  assert.equal(c.status, 'done');
  assert.equal(c.assigneeUserId, 'u2');
  assert.equal(c.projectId, 'inbox-u2'); // во «Входящие» делегата
  assert.equal(c.allowInboxDelegation, true);
  assert.equal(c.description, 'обновил прод');
});

test('«Готово …» с AI-разбиением → каждый сегмент в колонке «Готово»', async () => {
  const h = makeHarness({
    projects: [{ id: 'p1', name: 'Альфа' }, { id: 'p2', name: 'Бета' }],
    aiSegments: [
      seg1({ id: 's1', projectId: 'p1', projectName: 'Альфа' }),
      seg1({ id: 's2', projectId: 'p2', projectName: 'Бета' }),
    ],
  });
  await h.service.startFromMessage(111, 500, 'сделано раз и два');
  const draftId = [...h.drafts.keys()][0]!;
  const segs = h.drafts.get(draftId)!.segments!;
  assert.equal(segs.length, 2);
  assert.ok(segs.every((s) => s.targetStatus === 'done')); // все задачи сразу в «Готово»
  // Создаём все сегменты → задачи в done.
  await h.service.handleCallback(cq(`ac:${draftId}`));
  assert.ok(h.createTaskCalls.length >= 1);
  assert.ok(h.createTaskCalls.every((c) => c.status === 'done'));
});

test('повтор «Готово …» с тем же sourceKey не создаёт второй черновик', async () => {
  const h = makeHarness({ aiOutcome: 'timeout' });
  const opts = { sourceKey: 'm:500:3' } as const;
  await h.service.startFromMessage(111, 500, 'готово выкатил релиз', undefined, [], opts);
  await h.service.startFromMessage(111, 500, 'готово выкатил релиз', undefined, [], opts);
  assert.equal(h.drafts.size, 1); // ровно один черновик (идемпотентность по sourceKey)
});

test('«готовность …» НЕ считается фиксацией (обычный флоу, колонка не done)', async () => {
  const h = makeHarness({ aiOutcome: 'timeout' });
  await h.service.startFromMessage(111, 500, 'готовность к релизу проверить', undefined, [], {
    sourceKey: 'm:500:4',
  });
  const draft = h.drafts.get([...h.drafts.keys()][0]!)!;
  assert.notEqual(draft.targetStatus, 'done'); // обычный флоу — колонка НЕ «Готово»
  assert.match(draft.taskText ?? '', /готовность/); // слово осталось в тексте
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
  const confirmation = h.edits.at(-1)!.text;
  assert.match(confirmation, /Ответственный: <b>Создатель<\/b>/);
  assert.match(confirmation, /Статус: <b>Черновик<\/b>/);
});

test('+Проект (уникальный) текст → createTask в этот проект', async () => {
  const h = makeHarness();
  await h.service.startFromMessage(111, 500, '+Альфа Обнови билд');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`tc:${draftId}`));
  assert.equal(h.createTaskCalls[0]!.projectId, 'p1');
  assert.equal(h.createTaskCalls[0]!.description, 'Обнови билд');
});

test('ручное создание сохраняет группу и сообщение для отчёта, повтор callback не создаёт второй origin', async () => {
  const h = makeHarness();
  await h.service.startFromMessage(111, -100500, '+Альфа Обнови билд');
  const draft = [...h.drafts.values()][0]!;
  const callback = { ...cq(`tc:${draft.id}`), message: { message_id: 99, chat: { id: -100500 } } };
  await h.service.handleCallback(callback);
  await h.service.handleCallback(callback);
  assert.deepEqual(h.origins, [{ taskId: 't1', projectId: 'p1', chatId: -100500, messageId: draft.tgMessageId }]);
  assert.equal(h.createTaskCalls.length, 1);
});

test('«@hotspotping проджектфлоу воркеру» ставит задачу воркеру и сохраняет явно указанного ответственного', async () => {
  const h = makeHarness({ projects: [{ id: 'p1', name: 'ProjectsFlow' }], telegramUsernames: { hotspotping: 'u2' } });
  await h.service.startFromMessage(111, 500, '@hotspotping проджектфлоу воркеру исправить оформление уведомлений');
  const draft = [...h.drafts.values()][0]!;
  assert.equal(draft.projectId, 'p1');
  assert.equal(draft.targetStatus, 'todo');
  assert.equal(draft.assigneeUserId, 'u2');
  await h.service.handleCallback(cq(`tc:${draft.id}`));
  assert.equal(h.createTaskCalls[0]!.status, 'todo');
  assert.equal(h.createTaskCalls[0]!.assigneeUserId, 'u2');
});

test('воркер без явного ответственного закрепляется за автором, AI не подменяет его коллегой', async () => {
  const h = makeHarness({ aiSegments: [seg1({ assigneeUserId: 'u2', assigneeName: 'Вася' })] });
  await h.service.startFromMessage(111, 500, '+Альфа воркер исправь кнопку');
  const draft = [...h.drafts.values()][0]!;
  assert.equal(draft.segments![0]!.targetStatus, 'todo');
  assert.equal(draft.segments![0]!.assigneeUserId, 'u1');
  await h.service.handleCallback(cq(`ac:${draft.id}`));
  assert.equal(h.createTaskCalls[0]!.status, 'todo');
  assert.equal(h.createTaskCalls[0]!.assigneeUserId, 'u1');
});

test('@worker не попадает в пикер людей и явно выбранный человек сохраняется после AI', async () => {
  const h = makeHarness({ telegramUsernames: { hotspotping: 'u2' }, aiSegments: [seg1({ assigneeUserId: 'u1' })] });
  await h.service.startFromMessage(111, 500, '+Альфа Исправить кнопку @worker @hotspotping');
  const draft = [...h.drafts.values()][0]!;
  assert.equal(draft.segments![0]!.targetStatus, 'todo');
  assert.equal(draft.segments![0]!.assigneeUserId, 'u2');
});

test('явный запрос воркеру при выключенном воркере даёт причину вместо тихого создания черновика', async () => {
  const h = makeHarness({ workerEnabled: false });
  await h.service.startFromMessage(111, 500, '+Альфа Исправить кнопку @worker');
  await h.service.handleCallback(cq(`tc:${[...h.drafts.keys()][0]!}`));
  assert.equal(h.createTaskCalls.length, 0);
  assert.match(h.edits.at(-1)!.text, /воркер выключен/);
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

test('+Проект текст @ответственный → задача сразу в проекте, без дублирующей рассылки из композера', async () => {
  const h = makeHarness();
  await h.service.startFromMessage(111, 500, '+Альфа Обнови билд @Вася');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`tc:${draftId}`));
  assert.equal(h.createTaskCalls[0]!.projectId, 'p1'); // сразу в проект, без переноса-на-accept
  assert.equal(h.createTaskCalls[0]!.assigneeUserId, 'u2');
  assert.equal(h.assigneeMessages.length, 0); // Delivery belongs to the shared task-change stream.
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

// ===================== Оригинал сообщения в комментарии =====================

test('ручной флоу: созданная задача получает комментарий с оригиналом сообщения', async () => {
  const h = makeHarness({ aiOutcome: 'timeout' });
  await h.service.startFromMessage(111, 500, '+Альфа починить сборку на проде');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`tc:${draftId}`));
  assert.equal(h.createTaskCalls.length, 1);
  assert.equal(h.comments.length, 1);
  const c = h.comments[0]!;
  assert.equal(c.taskId, 't1');
  assert.equal(c.projectId, 'p1');
  assert.equal(c.actorKind, 'agent');
  assert.equal(c.agentName, 'telegram-composer');
  assert.match(c.body, /Оригинал сообщения/);
  assert.match(c.body, /починить сборку на проде/); // текст ДО перефраза
});

test('AI-сегменты: оригинал уходит комментарием в каждую созданную задачу', async () => {
  const h = makeHarness({
    projects: [
      { id: 'p1', name: 'Альфа' },
      { id: 'p2', name: 'Бета' },
    ],
    aiSegments: [
      seg1({ id: 's1', title: 'Раз', projectId: 'p1', projectName: 'Альфа' }),
      seg1({ id: 's2', title: 'Два', projectId: 'p2', projectName: 'Бета' }),
    ],
  });
  await h.service.startFromMessage(111, 500, 'надо сделать раз и два');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`ac:${draftId}`));
  assert.equal(h.createTaskCalls.length, 2);
  assert.equal(h.comments.length, 2);
  assert.deepEqual(h.origins.map(({ taskId, projectId, chatId }) => ({ taskId, projectId, chatId })), [
    { taskId: 't1', projectId: 'p1', chatId: 500 },
    { taskId: 't2', projectId: 'p2', chatId: 500 },
  ]);
  // Оригинал общий для всех сегментов одного сообщения.
  assert.ok(h.comments.every((c) => /надо сделать раз и два/.test(c.body)));
  assert.deepEqual(
    h.comments.map((c) => c.taskId),
    ['t1', 't2'],
  );
});

test('AI confirmation shows each actual assignee and selected status', async () => {
  const h = makeHarness({
    aiSegments: [
      seg1({ id: 's1', title: 'Раз', projectId: 'p1', assigneeUserId: 'u2', assigneeName: 'Вася' }),
      seg1({ id: 's2', title: 'Два', projectId: 'p1' }),
    ],
  });
  await h.service.startFromMessage(111, 500, 'Две задачи');
  const draftId = [...h.drafts.keys()][0]!;
  const draft = h.drafts.get(draftId)!;
  h.drafts.set(draftId, {
    ...draft,
    segments: draft.segments!.map((seg, index) => ({
      ...seg, targetStatus: index === 0 ? 'manual' : 'backlog',
    })),
  });
  await h.service.handleCallback(cq(`ac:${draftId}`));
  const confirmation = h.edits.at(-1)!.text;
  assert.equal(h.createTaskCalls.length, 2);
  assert.match(confirmation, /Раз<\/a>[^]*Ответственный: <b>Вася<\/b>\n📋 Статус: <b>В РУЧНУЮ<\/b>/);
  assert.match(confirmation, /Два<\/a>[^]*Ответственный: <b>Создатель<\/b>\n📋 Статус: <b>Черновик<\/b>/);
});

test('sourceExcerpt: в каждую задачу уходит ТОЛЬКО её фрагмент сообщения, а не всё письмо', async () => {
  const h = makeHarness({
    projects: [
      { id: 'p1', name: 'Альфа' },
      { id: 'p2', name: 'Бета' },
    ],
    aiSegments: [
      seg1({ id: 's1', title: 'Раз', projectId: 'p1', projectName: 'Альфа', sourceExcerpt: 'почини сборку' }),
      seg1({ id: 's2', title: 'Два', projectId: 'p2', projectName: 'Бета', sourceExcerpt: 'обнови счета' }),
    ],
  });
  await h.service.startFromMessage(111, 500, 'почини сборку, обнови счета');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`ac:${draftId}`));
  assert.equal(h.comments.length, 2);
  const [c1, c2] = h.comments as [{ body: string }, { body: string }];
  assert.match(c1.body, /почини сборку/);
  assert.doesNotMatch(c1.body.split('Связанные задачи')[0]!, /обнови счета/);
  assert.match(c2.body, /обнови счета/);
  assert.doesNotMatch(c2.body.split('Связанные задачи')[0]!, /почини сборку/);
});

test('связанные задачи: комментарий каждой задачи ссылается на остальные из того же сообщения', async () => {
  const h = makeHarness({
    projects: [
      { id: 'p1', name: 'Альфа' },
      { id: 'p2', name: 'Бета' },
    ],
    aiSegments: [
      seg1({ id: 's1', title: 'Раз', projectId: 'p1', projectName: 'Альфа' }),
      seg1({ id: 's2', title: 'Два', projectId: 'p2', projectName: 'Бета' }),
    ],
  });
  await h.service.startFromMessage(111, 500, 'надо сделать раз и два');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`ac:${draftId}`));
  assert.equal(h.comments.length, 2);
  const [c1, c2] = h.comments as [{ body: string }, { body: string }];
  // Каждая ссылается на соседа и НЕ ссылается на саму себя.
  assert.match(c1.body, /Связанные задачи/);
  assert.match(c1.body, /\[Два\]\(https:\/\/pf\.test\/projects\/p2\?task=t2\)/);
  assert.doesNotMatch(c1.body, /task=t1/);
  assert.match(c2.body, /\[Раз\]\(https:\/\/pf\.test\/projects\/p1\?task=t1\)/);
  assert.doesNotMatch(c2.body, /task=t2/);
});

test('одна задача из сообщения — блока «Связанные задачи» нет', async () => {
  const h = makeHarness({
    projects: [{ id: 'p1', name: 'Альфа' }],
    aiSegments: [seg1({ id: 's1', title: 'Раз' })],
  });
  await h.service.startFromMessage(111, 500, 'сделай раз');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`ac:${draftId}`));
  assert.equal(h.comments.length, 1);
  assert.doesNotMatch(h.comments[0]!.body, /Связанные задачи/);
});

test('отказ комментария не валит создание задачи', async () => {
  const h = makeHarness({ aiOutcome: 'timeout', commentOutcome: 'throw' });
  await h.service.startFromMessage(111, 500, '+Альфа что-то важное');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`tc:${draftId}`));
  assert.equal(h.createTaskCalls.length, 1); // задача создана
  assert.equal(h.comments.length, 0); // комментарий не записался — и это ок
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

test('AI: сегмент с ответственным → задача в проекте, уведомление через общий обработчик', async () => {
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
  assert.equal(h.assigneeMessages.length, 0); // Delivery belongs to the shared task-change stream.
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
  assert.equal(h.assigneeMessages.length, 0); // Delivery belongs to the shared task-change stream.
});

// Правка формулировки: AI не всегда попадает в смысл, а поправить текст было нечем —
// оставалось отменить карточку и надиктовать заново.
test('правка текста: ответ на просьбу меняет сегмент, а не создаёт вторую задачу', async () => {
  const h = makeHarness({
    projects: [{ id: 'p1', name: 'Альфа' }],
    aiSegments: [
      {
        id: 's1',
        title: 'Кривая формулировка',
        simpleBody: 'Непонятно что',
        projectId: 'p1',
        projectName: 'Альфа',
        confidence: 0.9,
        assigneeUserId: null,
        assigneeName: null,
        deadline: null,
      },
    ],
  });
  await h.service.startFromMessage(111, 500, 'сделать что-то');
  const draftId = [...h.drafts.keys()][0]!;

  await h.service.handleCallback(cq(`aw:${draftId}:0`)); // нажали «📝 Текст»
  assert.equal(h.drafts.get(draftId)!.awaitingTextSeg, 0);

  // Следующее сообщение — это правка, а НЕ новая задача.
  await h.service.startFromMessage(111, 500, 'Починить экспорт\nВыгрузка ломается на кириллице');
  assert.equal(h.drafts.size, 1, 'второй черновик означал бы, что ответ приняли за новую задачу');
  const seg = h.drafts.get(draftId)!.segments![0]!;
  assert.equal(seg.title, 'Починить экспорт');
  assert.equal(seg.body, 'Выгрузка ломается на кириллице');
  assert.equal(h.drafts.get(draftId)!.awaitingTextSeg, null, 'ожидание должно сбрасываться');

  // И правка не создала задачу сама по себе — создаёт по-прежнему кнопка.
  assert.equal(h.createTaskCalls.length, 0);
  await h.service.handleCallback(cq(`ac:${draftId}`));
  assert.ok(h.createTaskCalls[0]!.description.includes('Починить экспорт'));
});

test('правка текста: следующее сообщение после правки снова создаёт задачу', async () => {
  const h = makeHarness({
    projects: [{ id: 'p1', name: 'Альфа' }],
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
  await h.service.startFromMessage(111, 500, 'первая');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`aw:${draftId}:0`));
  await h.service.startFromMessage(111, 500, 'Новый текст'); // поглощено правкой
  await h.service.startFromMessage(111, 500, 'вторая задача'); // уже обычное сообщение

  assert.equal(h.drafts.size, 2, 'после сброса ожидания сообщение снова становится задачей');
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
  assert.equal(h.assigneeMessages.length, 0); // Delivery belongs to the shared task-change stream.
});

test('AI: делегированная задача — во «Входящие» ответственного в ЕГО пространстве, со ссылкой в ответе', async () => {
  // Инцидент 13.10.2026: пространство бралось активное у ОТПРАВИТЕЛЯ (последняя вкладка в
  // браузере) — ответственному создавались новые «Входящие (системный)» там, куда он не смотрит,
  // а бот отвечал «→ Входящие» без ссылок: «создал задачи, но в ПФ их не видно».
  const h = makeHarness({
    shared: [{ id: 'u2', displayName: 'Олег', email: 'o@e.com' }],
    delegatedInboxWorkspace: 'ws-u2',
    aiSegments: [
      {
        id: 's1',
        title: 'Дорисовать схему производства',
        simpleBody: 'Отметить камеру и пандус.',
        projectId: null,
        projectName: null,
        confidence: 0.9,
        assigneeUserId: 'u2',
        assigneeName: 'Олег',
        deadline: null,
      },
    ],
  });
  await h.service.startFromMessage(111, 500, 'олегу дорисовать схему производства');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`ac:${draftId}`));

  assert.deepEqual(h.delegatedResolverCalls, [['u2', 'u1']]);
  assert.deepEqual(h.inboxCalls, [{ ownerId: 'u2', actorId: 'u1', workspaceId: 'ws-u2' }]);
  assert.equal(h.createTaskCalls[0]!.projectId, 'inbox-u2');
  const reply = h.edits.at(-1)!.text;
  assert.ok(
    reply.includes('<a href="https://pf.test/projects/inbox-u2?task=t1">'),
    `в ответе нужна ссылка на задачу:\n${reply}`,
  );
  // Имя — из ответа CreateTask (в харнессе ответственный u2 всегда «Вася»).
  assert.ok(reply.includes('Входящие · Вася'), `видно, чьи это «Входящие»:\n${reply}`);
});

test('AI: своя задача без проекта — пространство не подсказываем (регрессия)', async () => {
  const h = makeHarness({
    delegatedInboxWorkspace: 'ws-u2',
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

  assert.deepEqual(h.delegatedResolverCalls, []);
  assert.deepEqual(h.inboxCalls, [{ ownerId: 'u1', actorId: 'u1', workspaceId: undefined }]);
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

// ===================== Дополнение существующей задачи (B3) =====================

test('обычное сообщение (не ответ) → всегда новая задача, даже если модель нашла похожую', async () => {
  // 14.10.2026: «саб по печати этикеток доработка …» бот дописал комментарием в старую задачу
  // «Печать этикеток» вместо новой. Дополнять можно только ответом на сообщение.
  const h = makeHarness({
    projects: [{ id: 'p1', name: 'Альфа' }],
    aiSegments: [seg1({ title: 'Убрать дату изготовления', existingTaskId: 'old-1' })],
    existingTasks: {
      'old-1': { id: 'old-1', projectId: 'p1', description: 'Печать этикеток', deletedAt: null },
    },
  });
  await h.service.startFromMessage(111, 500, 'доработка печати этикеток');
  const draftId = [...h.drafts.keys()][0]!;
  assert.ok(h.drafts.get(draftId)!.segments!.every((seg) => seg.existingTaskId === null));
  await h.service.handleCallback(cq(`ac:${draftId}`));
  assert.equal(h.createTaskCalls.length, 1);
  assert.match(h.createTaskCalls[0]!.description, /Убрать дату изготовления/);
  assert.ok(h.comments.every((c) => c.taskId !== 'old-1'), 'в старую задачу ничего не дописано');
  assert.ok(!h.edits.some((e) => /дополн/i.test(e.text)), 'карточка не обещает дополнить');
});

test('existingTaskId валиден и сообщение — ответ → комментарий в существующую задачу вместо новой', async () => {
  const h = makeHarness({
    projects: [{ id: 'p1', name: 'Альфа' }],
    aiSegments: [seg1({ title: 'Ещё деталь', existingTaskId: 'old-1' })],
    existingTasks: {
      'old-1': { id: 'old-1', projectId: 'p1', description: 'Починить сборку', deletedAt: null },
    },
  });
  await h.service.startFromMessage(111, 500, 'ещё про сборку', undefined, [], { reply: true });
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`ac:${draftId}`));
  assert.equal(h.createTaskCalls.length, 0); // новой задачи нет
  assert.equal(h.comments.length, 1);
  assert.equal(h.comments[0]!.taskId, 'old-1');
  assert.equal(h.comments[0]!.projectId, 'p1');
  assert.match(h.comments[0]!.body, /Ещё деталь/);
});

test('existingTaskId мёртвый/чужой → фолбэк на создание новой задачи', async () => {
  const h = makeHarness({
    projects: [{ id: 'p1', name: 'Альфа' }],
    aiSegments: [
      seg1({ id: 's1', title: 'Нет такой', existingTaskId: 'ghost' }),
      seg1({ id: 's2', title: 'Удалённая', existingTaskId: 'dead' }),
      seg1({ id: 's3', title: 'Чужой проект', existingTaskId: 'other' }),
    ],
    existingTasks: {
      dead: { id: 'dead', projectId: 'p1', description: 'Старая', deletedAt: new Date() },
      other: { id: 'other', projectId: 'p2', description: 'Из другого', deletedAt: null },
    },
  });
  await h.service.startFromMessage(111, 500, 'три сомнительных сегмента', undefined, [], { reply: true });
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`ac:${draftId}`));
  assert.equal(h.createTaskCalls.length, 3); // все три создались как обычные задачи
  // Комментарии — только «оригинал сообщения» к каждой созданной, без дополнений.
  assert.ok(h.comments.every((c) => /Оригинал сообщения/.test(c.body)));
});

test('Тип: классификация модели доезжает до создаваемой задачи', async () => {
  const h = makeHarness({
    projects: [{ id: 'p1', name: 'Альфа' }],
    aiSegments: [
      seg1({ id: 's1', title: 'Падает сборка', taskType: 'bug' }),
      seg1({ id: 's2', title: 'Новый экспорт', taskType: 'feature' }),
    ],
  });
  await h.service.startFromMessage(111, 500, 'сборка падает, и нужен экспорт');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`ac:${draftId}`));
  assert.deepEqual(
    h.createTaskCalls.map((c) => c.taskType),
    ['bug', 'feature'],
  );
});

test('Тип: модель не определила → задача создаётся без типа', async () => {
  const h = makeHarness({ projects: [{ id: 'p1', name: 'Альфа' }], aiSegments: [seg1()] });
  await h.service.startFromMessage(111, 500, 'сделать дело');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`ac:${draftId}`));
  assert.equal(h.createTaskCalls[0]!.taskType, null);
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

test('ИИ-разбор, оборванный перезапуском сервера, повторяется, а не становится сырой задачей', async () => {
  // 16.10.2026: сервер перезапустили, пока бот разбирал сообщения, — через 10 минут из них
  // создались сырые задачи во «Входящих», без проекта и перефразирования.
  const h = makeHarness({ aiSegments: [seg1()] });
  const ago = (ms: number) => new Date(Date.now() - ms);
  h.drafts.set('orphan', {
    id: 'orphan', creatorUserId: 'u1', tgChatId: 500, tgMessageId: 777, sourceKey: 'm:500:1',
    taskText: 'Починить отчёт', projectId: null, assigneeUserId: null, offered: null, segments: null,
    photos: [], attachments: [], targetStatus: null, awaitingTextSeg: null, workspaceId: null,
    workspacePending: false, replyContext: null, status: 'composing', createdAt: ago(11 * 60_000),
    autoCreateAt: ago(1_000), confirmationStartedAt: null, expiresAt: new Date(8640000000000000),
    aiStartedAt: ago(11 * 60_000),
  });

  assert.equal(await h.service.processDueAutoCreate(), 0);
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  assert.equal(h.createTaskCalls.length, 0);
  const draft = h.drafts.get('orphan')!;
  assert.equal(draft.status, 'composing');
  assert.equal(draft.segments?.length, 1);
  assert.equal(draft.aiStartedAt, null);
  assert.ok(draft.autoCreateAt && draft.autoCreateAt > new Date());
  // Карточка «Разбираю…» прошлого процесса переписана результатом, новая не отправлялась.
  assert.ok(h.edits.some((e) => e.messageId === 777));
  assert.equal(h.sent.length, 0);
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

// ===================== Битые id от модели и повторы автосоздания =====================

test('AI: битый id проекта восстанавливается по имени проекта', async () => {
  const h = makeHarness({
    projects: [{ id: 'p1', name: 'Альфа' }, { id: 'p2', name: 'Бета' }],
    // Так было в проде: модель потеряла символ в UUID, но имя проекта вернула верно.
    aiSegments: [seg1({ projectId: 'p-broken', projectName: 'альфа' })],
  });
  await h.service.startFromMessage(111, 500, 'почини сборку');
  const draftId = [...h.drafts.keys()][0]!;
  const seg = h.drafts.get(draftId)!.segments![0]!;
  assert.equal(seg.projectId, 'p1');
  assert.equal(seg.projectName, 'Альфа');
  await h.service.handleCallback(cq(`ac:${draftId}`));
  assert.equal(h.createTaskCalls[0]!.projectId, 'p1');
});

test('AI: битый id без узнаваемого имени → «Входящие», а не вечный «Project not found»', async () => {
  const h = makeHarness({
    projects: [{ id: 'p1', name: 'Альфа' }],
    aiSegments: [seg1({ projectId: 'p-broken', projectName: 'Гамма' })],
  });
  await h.service.startFromMessage(111, 500, 'почини сборку');
  const draftId = [...h.drafts.keys()][0]!;
  assert.equal(h.drafts.get(draftId)!.segments![0]!.projectId, null);
  await h.service.handleCallback(cq(`ac:${draftId}`));
  assert.equal(h.createTaskCalls[0]!.projectId, 'inbox1');
});

test('AI: id ответственного не из участников отбрасывается, имя ещё может сматчиться', async () => {
  const h = makeHarness({
    projects: [{ id: 'p1', name: 'Альфа' }],
    aiSegments: [
      seg1({ id: 's1', assigneeUserId: 'ghost', assigneeName: 'Вася' }),
      seg1({ id: 's2', assigneeUserId: 'ghost', assigneeName: null }),
      seg1({ id: 's3', assigneeUserId: 'u1', assigneeName: null }),
    ],
  });
  await h.service.startFromMessage(111, 500, 'три задачи');
  const draftId = [...h.drafts.keys()][0]!;
  assert.deepEqual(
    h.drafts.get(draftId)!.segments!.map((s) => s.assigneeUserId),
    ['u2', null, 'u1'],
  );
});

test('автосоздание: отказ, который повтор не исправит, закрывает черновик сразу', async () => {
  const h = makeHarness({
    projects: [{ id: 'p1', name: 'Альфа' }],
    aiSegments: [seg1({ title: 'Скрыть чужие задачи' })],
    createTaskError: () => new ProjectNotFoundError(),
  });
  await h.service.startFromMessage(111, 500, 'скрыть чужие задачи');
  const draftId = [...h.drafts.keys()][0]!;
  const draft = h.drafts.get(draftId)!;
  h.drafts.set(draftId, { ...draft, autoCreateAt: new Date(Date.now() - 1_000) });

  assert.equal(await h.service.processDueAutoCreate(), 1);
  assert.equal(h.drafts.get(draftId)!.status, 'cancelled');
  assert.equal(h.drafts.get(draftId)!.autoCreateAt, null);
  const card = h.edits[h.edits.length - 1]!.text;
  assert.match(card, /Скрыть чужие задачи — проект не найден или нет доступа/);
  assert.match(card, /Черновик закрыт/);
  assert.equal(await h.service.processDueAutoCreate(), 0);
});

test('автосоздание: временный сбой повторяется через минуту, но не дольше суток', async () => {
  const h = makeHarness({
    projects: [{ id: 'p1', name: 'Альфа' }],
    aiSegments: [seg1()],
    createTaskError: () => new Error('connect ENOENT /run/mysqld/mysqld.sock'),
  });
  await h.service.startFromMessage(111, 500, 'задача');
  const draftId = [...h.drafts.keys()][0]!;
  let draft = h.drafts.get(draftId)!;
  h.drafts.set(draftId, { ...draft, autoCreateAt: new Date(Date.now() - 1_000) });

  assert.equal(await h.service.processDueAutoCreate(), 1);
  draft = h.drafts.get(draftId)!;
  assert.equal(draft.status, 'composing');
  assert.ok(draft.autoCreateAt! > new Date(), 'повтор назначен на будущее');
  assert.match(h.edits[h.edits.length - 1]!.text, /Повторю через минуту/);

  // Черновик бьётся больше суток — дальше не повторяем.
  h.drafts.set(draftId, {
    ...draft,
    createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    autoCreateAt: new Date(Date.now() - 1_000),
  });
  assert.equal(await h.service.processDueAutoCreate(), 1);
  assert.equal(h.drafts.get(draftId)!.status, 'cancelled');
  assert.match(h.edits[h.edits.length - 1]!.text, /Черновик закрыт/);
});

test('ручной черновик: нет прав в проекте → черновик закрыт с причиной, без повторов', async () => {
  const h = makeHarness({
    aiOutcome: 'timeout',
    createTaskError: () => new InsufficientProjectRoleError('viewer', 'create_task'),
  });
  await h.service.startFromMessage(111, 500, 'починить сборку');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`tc:${draftId}`));
  assert.equal(h.drafts.get(draftId)!.status, 'cancelled');
  assert.match(h.answers[h.answers.length - 1]!.text ?? '', /нет прав создавать задачи/);
  assert.match(h.edits[h.edits.length - 1]!.text, /Черновик закрыт/);
});

// ===================== Пространство задач без проекта =====================

const SPACE_ME = { id: 'w-me', name: 'Личное', icon: null, kind: 'default' as const };
const SPACE_TEAM = { id: 'w-team', name: 'Команда', icon: '🚀', kind: 'team' as const };
const SPACE_STUDIO = { id: 'w-studio', name: 'Студия', icon: null, kind: 'team' as const };

// callback_data всех кнопок карточки.
function buttonData(replyMarkup: any): string[] {
  const rows = replyMarkup?.inline_keyboard ?? [];
  return rows.flat().map((b: any) => b.callback_data as string).filter(Boolean);
}

// Последняя карточка, которую видел пользователь (правка сообщения или новое сообщение).
function lastCard(h: ReturnType<typeof makeHarness>): { text: string; replyMarkup?: any } {
  return h.edits[h.edits.length - 1] ?? (h.sent[h.sent.length - 1] as any);
}

test('пространство: одно — бот не спрашивает и кладёт во «Входящие» этого пространства', async () => {
  const h = makeHarness({ workspaces: { list: [SPACE_ME] } });
  await h.service.startFromMessage(111, 500, 'Купить кофе');
  const draftId = [...h.drafts.keys()][0]!;
  assert.equal(h.drafts.get(draftId)!.workspaceId, 'w-me');
  assert.match(lastCard(h).text, /Новая задача/);
  assert.ok(!buttonData(lastCard(h).replyMarkup).some((d) => d.startsWith('ws:')));
  assert.match(lastCard(h).text, /Пространство: <b>Личное<\/b>/);
  await h.service.handleCallback(cq(`tc:${draftId}`));
  assert.equal(h.createTaskCalls[0]!.projectId, 'inbox1@w-me');
});

test('пространство: два и подсказок нет — кнопки выбора; «Создать» до выбора ничего не создаёт', async () => {
  const h = makeHarness({ workspaces: { list: [SPACE_TEAM, SPACE_ME] } });
  await h.service.startFromMessage(111, 500, 'Купить кофе');
  const draftId = [...h.drafts.keys()][0]!;
  assert.equal(h.drafts.get(draftId)!.workspacePending, true);
  const card = lastCard(h);
  assert.match(card.text, /Пространство: <b>не выбрано<\/b>/);
  const data = buttonData(card.replyMarkup);
  assert.ok(data.includes(`ws:${draftId}:w-me`));
  assert.ok(data.includes(`ws:${draftId}:w-team`));
  assert.equal(data[0], `ws:${draftId}:w-me`); // личное — первой кнопкой

  await h.service.handleCallback(cq(`tc:${draftId}`));
  assert.equal(h.createTaskCalls.length, 0);
  assert.match(h.answers[h.answers.length - 1]!.text ?? '', /выбери пространство/);
  assert.equal(h.drafts.get(draftId)!.status, 'composing');

  await h.service.handleCallback(cq(`ws:${draftId}:w-team`));
  const chosen = h.drafts.get(draftId)!;
  assert.equal(chosen.workspaceId, 'w-team');
  assert.equal(chosen.workspacePending, false);
  assert.deepEqual(h.savedChoices, [{ chatId: 500, userId: 'u1', workspaceId: 'w-team' }]);
  assert.match(lastCard(h).text, /Пространство: <b>Команда<\/b>/);
  // После выбора — кнопка «🗂 Пространство», чтобы передумать.
  assert.ok(buttonData(lastCard(h).replyMarkup).includes(`ws:${draftId}:?`));

  await h.service.handleCallback(cq(`tc:${draftId}`));
  assert.equal(h.createTaskCalls.length, 1);
  assert.equal(h.createTaskCalls[0]!.projectId, 'inbox1@w-team');
  assert.match(lastCard(h).text, /Входящие · Команда/);
});

test('пространство: выбор запоминается — следующая задача из этого чата без вопроса', async () => {
  const h = makeHarness({ workspaces: { list: [SPACE_ME, SPACE_TEAM] } });
  await h.service.startFromMessage(111, 500, 'Первая задача');
  const first = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`ws:${first}:w-team`));

  await h.service.startFromMessage(111, 500, 'Вторая задача');
  const second = [...h.drafts.keys()][1]!;
  const draft = h.drafts.get(second)!;
  assert.equal(draft.workspaceId, 'w-team');
  assert.equal(draft.workspacePending, false);
});

test('пространство: выбор в личке старше 12 часов — снова спрашиваем', async () => {
  const h = makeHarness({
    workspaces: {
      list: [SPACE_ME, SPACE_TEAM],
      choices: { '500:u1': { workspaceId: 'w-team', chosenAt: new Date(Date.now() - 13 * 60 * 60 * 1000) } },
    },
  });
  await h.service.startFromMessage(111, 500, 'Купить кофе');
  assert.equal([...h.drafts.values()][0]!.workspacePending, true);
});

test('пространство: группа привязана к пространству — без вопроса', async () => {
  const h = makeHarness({ workspaces: { list: [SPACE_ME, SPACE_TEAM], linked: { [-100500]: ['w-team'] } } });
  await h.service.startFromMessage(111, -100500, 'Починить сборку', gctx('u1', 'Босс'));
  const draft = [...h.drafts.values()][0]!;
  assert.equal(draft.workspaceId, 'w-team');
  assert.equal(draft.workspacePending, false);
});

test('пространство: ответственный состоит только в одном — туда, без вопроса', async () => {
  const h = makeHarness({
    workspaces: { list: [SPACE_ME, SPACE_TEAM, SPACE_STUDIO], members: { 'w-team': ['u2'] } },
  });
  await h.service.startFromMessage(111, 500, 'обновить прод @Вася');
  const draftId = [...h.drafts.keys()][0]!;
  assert.equal(h.drafts.get(draftId)!.workspaceId, 'w-team');
  await h.service.handleCallback(cq(`tc:${draftId}`));
  const call = h.createTaskCalls[0]!;
  assert.equal(call.projectId, 'inbox-u2@w-team'); // «Входящие» Васи в общем пространстве
  assert.equal(call.allowInboxDelegation, true);
});

test('пространство: авто-создание без выбора — в личное пространство', async () => {
  const h = makeHarness({ workspaces: { list: [SPACE_TEAM, SPACE_ME] } });
  await h.service.startFromMessage(111, 500, 'Купить кофе');
  const draftId = [...h.drafts.keys()][0]!;
  assert.match(lastCard(h).text, /через 10 минут положу во «Входящие» пространства «Личное»/);
  h.drafts.set(draftId, { ...h.drafts.get(draftId)!, autoCreateAt: new Date(Date.now() - 1_000) });

  assert.equal(await h.service.processDueAutoCreate(), 1);
  assert.equal(h.createTaskCalls.length, 1);
  assert.equal(h.createTaskCalls[0]!.projectId, 'inbox1@w-me');
});

test('пространство: авто-создание без выбора и без личного — ждём кнопку; выбор снова заводит таймер', async () => {
  const h = makeHarness({ workspaces: { list: [SPACE_TEAM, SPACE_STUDIO] } });
  await h.service.startFromMessage(111, 500, 'Купить кофе');
  const draftId = [...h.drafts.keys()][0]!;
  assert.match(lastCard(h).text, /Пока пространство не выбрано, задачу не создам/);
  h.drafts.set(draftId, { ...h.drafts.get(draftId)!, autoCreateAt: new Date(Date.now() - 1_000) });

  await h.service.processDueAutoCreate();
  assert.equal(h.createTaskCalls.length, 0);
  const parked = h.drafts.get(draftId)!;
  assert.equal(parked.status, 'composing');
  assert.equal(parked.autoCreateAt, null); // тик больше не трогает черновик

  await h.service.handleCallback(cq(`ws:${draftId}:w-studio`));
  const armed = h.drafts.get(draftId)!;
  assert.ok(armed.autoCreateAt, 'выбор пространства снова заводит авто-создание');
  h.drafts.set(draftId, { ...armed, autoCreateAt: new Date(Date.now() - 1_000) });
  assert.equal(await h.service.processDueAutoCreate(), 1);
  assert.equal(h.createTaskCalls[0]!.projectId, 'inbox1@w-studio');
});

test('пространство: задача с проектом — не спрашиваем, проект подписан своим пространством', async () => {
  const h = makeHarness({
    projects: [{ id: 'p1', name: 'Альфа', workspaceId: 'w-team' }],
    workspaces: { list: [SPACE_ME, SPACE_TEAM] },
  });
  await h.service.startFromMessage(111, 500, '+Альфа Обнови билд');
  const draftId = [...h.drafts.keys()][0]!;
  const card = lastCard(h);
  assert.match(card.text, /Альфа · Команда/);
  assert.doesNotMatch(card.text, /не выбрано/);
  assert.ok(!buttonData(card.replyMarkup).some((d) => d.startsWith('ws:')));
  await h.service.handleCallback(cq(`tc:${draftId}`));
  assert.equal(h.createTaskCalls[0]!.projectId, 'p1');
});

test('пространство: AI-сегмент без проекта — тот же выбор кнопкой перед «Создать»', async () => {
  const h = makeHarness({
    aiSegments: [seg1({ projectId: null, projectName: null })],
    workspaces: { list: [SPACE_ME, SPACE_TEAM] },
  });
  await h.service.startFromMessage(111, 500, 'купить молоко');
  const draftId = [...h.drafts.keys()][0]!;
  assert.ok(h.drafts.get(draftId)!.segments);
  assert.ok(buttonData(lastCard(h).replyMarkup).includes(`ws:${draftId}:w-me`));

  await h.service.handleCallback(cq(`ac:${draftId}`));
  assert.equal(h.createTaskCalls.length, 0);

  await h.service.handleCallback(cq(`ws:${draftId}:w-me`));
  await h.service.handleCallback(cq(`ac:${draftId}`));
  assert.equal(h.createTaskCalls.length, 1);
  assert.equal(h.createTaskCalls[0]!.projectId, 'inbox1@w-me');
});

test('пространство: пикер «🗂 Пространство» и «Назад» возвращают карточку', async () => {
  const h = makeHarness({
    workspaces: {
      list: [SPACE_ME, SPACE_TEAM],
      choices: { '500:u1': { workspaceId: 'w-me', chosenAt: new Date() } },
    },
  });
  await h.service.startFromMessage(111, 500, 'Купить кофе');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`ws:${draftId}:?`));
  assert.match(lastCard(h).text, /В какое пространство/);
  assert.ok(buttonTexts(lastCard(h).replyMarkup).some((t) => t.startsWith('✓ ') && t.includes('Личное')));
  await h.service.handleCallback(cq(`ws:${draftId}:b`));
  assert.match(lastCard(h).text, /Новая задача/);
});

test('пространство: чужое пространство в кнопке отвергается', async () => {
  const h = makeHarness({ workspaces: { list: [SPACE_ME, SPACE_TEAM] } });
  await h.service.startFromMessage(111, 500, 'Купить кофе');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`ws:${draftId}:w-foreign`));
  assert.equal(h.drafts.get(draftId)!.workspaceId, null);
  assert.match(h.answers[h.answers.length - 1]!.text ?? '', /недоступно/);
});

test('пространство: одноимённые проекты разных пространств — пикер с подписями, а не первый попавшийся', async () => {
  const h = makeHarness({
    projects: [
      { id: 'p-team', name: 'Сайт', workspaceId: 'w-team' },
      { id: 'p-studio', name: 'Сайт', workspaceId: 'w-studio' },
    ],
    workspaces: { list: [SPACE_ME, SPACE_TEAM, SPACE_STUDIO] },
  });
  await h.service.startFromMessage(111, 500, '+Сайт поправить шапку');
  const draftId = [...h.drafts.keys()][0]!;
  const texts = buttonTexts(lastCard(h).replyMarkup);
  assert.ok(texts.includes('Сайт · Команда'));
  assert.ok(texts.includes('Сайт · Студия'));
  assert.equal(h.drafts.get(draftId)!.taskText, 'поправить шапку');

  const studioIdx = h.drafts.get(draftId)!.offered!.projects!.findIndex((p) => p.id === 'p-studio');
  await h.service.handleCallback(cq(`tp:${draftId}:${studioIdx}`));
  await h.service.handleCallback(cq(`tc:${draftId}`));
  assert.equal(h.createTaskCalls[0]!.projectId, 'p-studio');
});

test('пространство: решено ещё до ответа AI — авто-создание до разбора кладёт туда же', async () => {
  let releaseAi!: () => void;
  const aiGate = new Promise<void>((resolve) => {
    releaseAi = resolve;
  });
  const h = makeHarness({
    aiGate,
    aiSegments: [seg1({ projectId: null, projectName: null })],
    workspaces: {
      list: [SPACE_ME, SPACE_TEAM],
      choices: { '500:u1': { workspaceId: 'w-team', chosenAt: new Date() } },
    },
  });
  await h.service.startFromMessage(111, 500, 'купить молоко', undefined, [], {
    sourceKey: 'm:500:ws-long-ai',
    background: true,
  });
  const draftId = [...h.drafts.keys()][0]!;
  assert.equal(h.drafts.get(draftId)!.workspaceId, 'w-team'); // AI ещё думает
  h.drafts.set(draftId, { ...h.drafts.get(draftId)!, autoCreateAt: new Date(Date.now() - 1_000) });
  assert.equal(await h.service.processDueAutoCreate(), 1);
  assert.equal(h.createTaskCalls[0]!.projectId, 'inbox1@w-team');
  releaseAi();
});

test('пространство: непривязанный участник группы — во «Входящие» владельца в пространстве группы', async () => {
  const h = makeHarness({ workspaces: { list: [SPACE_ME, SPACE_TEAM], linked: { [-100500]: ['w-team'] } } });
  await h.service.startFromMessage(999, -100500, 'подготовить отчёт', gctx('u1', 'Гость'));
  assert.equal(h.createTaskCalls.length, 1);
  assert.equal(h.createTaskCalls[0]!.projectId, 'inbox1@w-team');
});

test('поручение: общий личный хаб и команда требуют выбора; таймер не угадывает', async () => {
  const h = makeHarness({ workspaces: { list: [SPACE_ME, SPACE_TEAM],
    members: { 'w-me': ['u2'], 'w-team': ['u2'] },
    choices: { '500:u1': { workspaceId: 'w-team', chosenAt: new Date() } } } });
  await h.service.startFromMessage(111, 500, 'Сделать фотографии @Вася');
  const draftId = [...h.drafts.keys()][0]!;
  assert.equal(h.drafts.get(draftId)!.workspacePending, true);
  assert.ok(buttonData(lastCard(h).replyMarkup).includes(`ws:${draftId}:w-team`));
  assert.match(lastCard(h).text, /Пока пространство не выбрано/u);
  h.drafts.set(draftId, { ...h.drafts.get(draftId)!, autoCreateAt: new Date(Date.now() - 1000) });
  await h.service.processDueAutoCreate();
  assert.equal(h.createTaskCalls.length, 0);
  assert.equal(h.drafts.get(draftId)!.autoCreateAt, null);
  await h.service.handleCallback(cq(`ws:${draftId}:w-team`));
  await h.service.handleCallback(cq(`tc:${draftId}`));
  assert.equal(h.createTaskCalls[0]!.projectId, 'inbox-u2@w-team');
  assert.equal(h.createTaskCalls[0]!.ownerUserId, 'u1');
});

test('AI: валидный id одноимённого проекта не позволяет модели выбрать пространство за автора', async () => {
  const h = makeHarness({
    projects: [{ id: 'p-team', name: 'Сайт', workspaceId: 'w-team' }, { id: 'p-studio', name: 'Сайт', workspaceId: 'w-studio' }],
    workspaces: { list: [SPACE_TEAM, SPACE_STUDIO] },
    aiSegments: [seg1({ projectId: 'p-team', projectName: 'Сайт' })],
  });
  await h.service.startFromMessage(111, 500, 'На сайте исправить меню');
  const draftId = [...h.drafts.keys()][0]!;
  const draft = h.drafts.get(draftId)!;
  assert.equal(draft.segments![0]!.projectId, null);
  assert.deepEqual(draft.segments![0]!.projectChoices?.map((p) => p.id), ['p-team', 'p-studio']);
  assert.ok(buttonTexts(lastCard(h).replyMarkup).includes('Сайт · Студия'));
  await h.service.handleCallback(cq(`ac:${draftId}`));
  assert.equal(h.createTaskCalls.length, 0);
  h.drafts.set(draftId, { ...h.drafts.get(draftId)!, autoCreateAt: new Date(Date.now() - 1000) });
  await h.service.processDueAutoCreate();
  assert.equal(h.createTaskCalls.length, 0);
  await h.service.handleCallback(cq(`ap:${draftId}:0:1`));
  assert.ok(h.drafts.get(draftId)!.autoCreateAt, 'выбор проекта снова запускает таймер после ожидания');
  await h.service.handleCallback(cq(`ac:${draftId}`));
  assert.equal(h.createTaskCalls[0]!.projectId, 'p-studio');
});

test('AI: одноимённые проекты сопоставляются с общим пространством автора и исполнителя', async () => {
  const h = makeHarness({
    projects: [{ id: 'p-team', name: 'Сайт', workspaceId: 'w-team' }, { id: 'p-studio', name: 'Сайт', workspaceId: 'w-studio' }],
    workspaces: { list: [SPACE_TEAM, SPACE_STUDIO], members: { 'w-studio': ['u2'] } },
    aiSegments: [seg1({ projectId: 'p-team', projectName: 'Сайт', assigneeUserId: 'u2', assigneeName: 'Вася' })],
  });
  await h.service.startFromMessage(111, 500, 'На сайте исправить меню @Вася');
  const draftId = [...h.drafts.keys()][0]!;
  assert.equal(h.drafts.get(draftId)!.segments![0]!.projectId, 'p-studio');
  await h.service.handleCallback(cq(`ac:${draftId}`));
  assert.equal(h.createTaskCalls[0]!.projectId, 'p-studio');
});

test('явный +одноимённый проект требует выбора даже при успешном AI', async () => {
  const h = makeHarness({
    projects: [{ id: 'p-team', name: 'Сайт', workspaceId: 'w-team' }, { id: 'p-studio', name: 'Сайт', workspaceId: 'w-studio' }],
    workspaces: { list: [SPACE_TEAM, SPACE_STUDIO] },
    aiSegments: [seg1({ projectId: 'p-team', projectName: 'Сайт' })],
  });
  await h.service.startFromMessage(111, 500, '+Сайт исправить меню');
  const draftId = [...h.drafts.keys()][0]!;
  assert.equal(h.drafts.get(draftId)!.segments, null);
  await h.service.handleCallback(cq(`tc:${draftId}`));
  assert.equal(h.createTaskCalls.length, 0);
  await h.service.handleCallback(cq(`tp:${draftId}:1`));
  await h.service.handleCallback(cq(`tc:${draftId}`));
  assert.equal(h.createTaskCalls[0]!.projectId, 'p-studio');
});

test('явный @исполнитель сохраняется при пропуске исполнителя моделью и участвует в выборе пространства', async () => {
  const h = makeHarness({
    workspaces: { list: [SPACE_ME, SPACE_TEAM, SPACE_STUDIO], members: { 'w-team': ['u2'], 'w-studio': ['u2'] } },
    aiSegments: [seg1({ projectId: null, projectName: null, assigneeUserId: null, assigneeName: null })],
  });
  await h.service.startFromMessage(111, 500, 'Сделать фотографии @Вася');
  const draftId = [...h.drafts.keys()][0]!;
  assert.equal(h.drafts.get(draftId)!.segments![0]!.assigneeUserId, 'u2');
  assert.equal(h.drafts.get(draftId)!.workspacePending, true);
  assert.ok(!buttonData(lastCard(h).replyMarkup).includes(`ws:${draftId}:w-me`));
  await h.service.handleCallback(cq(`ws:${draftId}:w-studio`));
  await h.service.handleCallback(cq(`ac:${draftId}`));
  assert.equal(h.createTaskCalls[0]!.projectId, 'inbox-u2@w-studio');
  assert.equal(h.createTaskCalls[0]!.assigneeUserId, 'u2');
});

test('задача ответом на сообщение: то сообщение — в комментарии рядом с оригиналом', async () => {
  const h = makeHarness({ projects: [{ id: 'p1', name: 'Альфа' }], aiSegments: [seg1({ title: 'Проверить остатки' })] });
  await h.service.startFromMessage(111, 500, 'сегодня проверить остатки', undefined, [], {
    replyContext: { from: 'MagDay', text: '⚠️ Остатки: расхождения\n497 записей' },
  });
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`ac:${draftId}`));
  assert.equal(h.createTaskCalls.length, 1);
  const body = h.comments[0]!.body;
  assert.match(body, /Оригинал сообщения/);
  assert.match(body, /В ответ на сообщение от MagDay/);
  assert.match(body, /> ⚠️ Остатки: расхождения\n> 497 записей/);
});

test('ответ на сообщение, из которого уже создана задача: проект, ответственный и колонка — как у неё', async () => {
  // 15.10.2026: «@бот ещё … сделать кнопку» ответом на сообщение-задачу падало во «Входящие»
  // на автора и в «Черновики», хотя та задача — в проекте, у Васи, «Вручную».
  const h = makeHarness({
    projects: [{ id: 'p1', name: 'Альфа' }],
    aiSegments: [seg1({ title: 'Кнопка по центру', projectId: null, projectName: null })],
    existingTasks: {
      'old-1': { id: 'old-1', projectId: 'p1', status: 'manual', assignee: { userId: 'u2', displayName: 'Вася', avatarUrl: null }, deletedAt: null },
    },
    taskMessageLinks: { '500:77': { taskId: 'old-1', projectId: 'p1' } },
  });
  // Сообщение 42 уже стало задачей: черновик подтверждён, его карточка — сообщение 77.
  h.drafts.set('src', { id: 'src', sourceKey: 'm:500:42', status: 'confirmed', tgMessageId: 77, creatorUserId: 'u1', tgChatId: 500, segments: null, projectId: null, assigneeUserId: null, targetStatus: null } as any);
  await h.service.startFromMessage(111, 500, 'ещё сделать кнопку по центру', undefined, [], { replyToMessageId: 42 });
  const draft = [...h.drafts.values()].find((d) => d.id !== 'src')!;
  await h.service.handleCallback(cq(`ac:${draft.id}`));
  assert.equal(h.createTaskCalls.length, 1);
  assert.equal(h.createTaskCalls[0]!.projectId, 'p1');
  assert.equal(h.createTaskCalls[0]!.assigneeUserId, 'u2');
  assert.equal(h.createTaskCalls[0]!.status, 'manual');
});

test('ИИ недоступен из-за лимита подписки — карточка честно говорит об этом', async () => {
  const h = makeHarness({ aiOutcome: 'fail', aiError: 'llm_failed: Достигнут лимит подписки ChatGPT — повторите позже.' });
  await h.service.startFromMessage(111, 500, 'магдей сделать шрифт крупнее');
  const card = h.edits.at(-1)?.text ?? h.sent.at(-1)?.text ?? '';
  assert.match(card, /лимит подписки ChatGPT/);
  assert.match(card, /Новая задача/);
});
