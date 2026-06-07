import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TelegramComposerService, type TelegramCallbackQuery } from './TelegramComposerService.js';
import type { TelegramTaskDraft } from '../TelegramTaskDraftRepository.js';

// --- Минимальные in-memory фейки (tsx + node:test, без новых deps). ---

type CreateTaskCall = {
  projectId: string;
  description: string;
  delegateUserId?: string | null;
  deadline?: string | null;
};

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
}) {
  const projects = opts?.projects ?? [{ id: 'p1', name: 'Альфа' }];
  const shared = opts?.shared ?? [{ id: 'u2', displayName: 'Вася', email: 'v@e.com' }];
  const aiSegments = opts?.aiSegments;
  const aiOutcome = opts?.aiOutcome ?? (aiSegments ? undefined : 'enqueue-throw');

  const drafts = new Map<string, TelegramTaskDraft>();
  let seq = 0;
  const createTaskCalls: CreateTaskCall[] = [];
  const sent: { chatId: number; text: string }[] = [];
  const edits: { messageId: number; text: string }[] = [];
  const answers: { text?: string }[] = [];
  const delegateMessages: { userId: string; hasButtons: boolean }[] = [];
  const accepted: string[] = [];
  const declined: string[] = [];
  const assigned: { taskId: string; projectId: string }[] = [];

  const draftsRepo = {
    async create(input: any): Promise<TelegramTaskDraft> {
      const id = `d${++seq}`;
      const d: TelegramTaskDraft = {
        id,
        creatorUserId: input.creatorUserId,
        tgChatId: input.tgChatId,
        taskText: input.taskText,
        projectId: input.projectId ?? null,
        delegateUserId: input.delegateUserId ?? null,
        delegationId: null,
        offered: input.offered ?? null,
        segments: input.segments ?? null,
        status: 'composing',
        createdAt: new Date(0),
        expiresAt: new Date(8640000000000000),
      };
      drafts.set(id, d);
      return d;
    },
    async getById(id: string) {
      return drafts.get(id) ?? null;
    },
    async getByDelegationId(delegationId: string) {
      for (const d of drafts.values()) if (d.delegationId === delegationId) return d;
      return null;
    },
    async patch(id: string, patch: any) {
      const cur = drafts.get(id);
      if (!cur) return null;
      const next = { ...cur, ...patch } as TelegramTaskDraft;
      drafts.set(id, next);
      return next;
    },
    async deleteExpired() {
      return 0;
    },
  };

  const client = {
    async sendMessage(input: any) {
      sent.push({ chatId: input.chatId, text: input.text });
      return { kind: 'ok' as const, messageId: 1000 + sent.length };
    },
    async editMessageText(input: any) {
      edits.push({ messageId: input.messageId, text: input.text });
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
      async findForProject(projectId: string) {
        return { projectId, userId: 'u2', role: 'editor' } as any; // делегат — участник
      },
    },
    projects: {
      async getById(id: string) {
        const p = projects.find((x) => x.id === id);
        return p ? ({ ...p, isInbox: false } as any) : ({ id, name: 'Входящие', isInbox: true } as any);
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
          description: input.description,
          delegateUserId: input.delegateUserId ?? null,
          deadline: input.deadline ?? null,
        });
        return {
          id: 't1',
          projectId: input.projectId,
          delegation: input.delegateUserId ? { id: 'del1' } : null,
        } as any;
      },
    },
    getOrCreateInbox: {
      async execute() {
        return { id: 'inbox1', name: 'Входящие', isInbox: true } as any;
      },
    },
    accept: {
      async execute(delegationId: string, userId: string) {
        accepted.push(delegationId);
        return {
          id: delegationId,
          taskId: 't1',
          delegateUserId: userId,
          delegateDisplayName: 'Вася',
          creatorUserId: 'u1',
          creatorDisplayName: 'Создатель',
          status: 'accepted',
          createdAt: new Date(0),
          respondedAt: new Date(0),
        } as any;
      },
    },
    decline: {
      async execute(delegationId: string, userId: string) {
        declined.push(delegationId);
        return {
          id: delegationId,
          taskId: 't1',
          delegateUserId: userId,
          delegateDisplayName: 'Вася',
          creatorUserId: 'u1',
          creatorDisplayName: 'Создатель',
          status: 'declined',
          createdAt: new Date(0),
          respondedAt: new Date(0),
        } as any;
      },
    },
    assignToProject: {
      async execute(taskId: string, projectId: string) {
        assigned.push({ taskId, projectId });
        return { id: taskId, projectId } as any;
      },
    },
    sendNotification: {
      async execute(cmd: any) {
        delegateMessages.push({ userId: cmd.userId, hasButtons: !!cmd.replyMarkup });
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
    idGen: () => 'uuid',
    shortIdGen: () => `s${++seq}`,
    appUrl: 'https://pf.test',
  };

  const service = new TelegramComposerService(deps as any);
  return { service, drafts, createTaskCalls, sent, edits, answers, delegateMessages, accepted, declined, assigned };
}

function cq(draftIdOrData: string, tgUserId = 111): TelegramCallbackQuery {
  return {
    id: 'cq1',
    from: { id: tgUserId },
    message: { message_id: 99, chat: { id: 500 } },
    data: draftIdOrData,
  };
}

test('голый текст → черновик во «Входящие», confirm → createTask в inbox', async () => {
  const h = makeHarness();
  await h.service.startFromMessage(111, 500, 'Купить кофе');
  assert.equal(h.sent.length, 1); // карточка-подтверждение
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`tc:${draftId}`));
  assert.equal(h.createTaskCalls.length, 1);
  assert.equal(h.createTaskCalls[0]!.projectId, 'inbox1'); // ушло в inbox
  assert.equal(h.createTaskCalls[0]!.description, 'Купить кофе');
  assert.equal(h.createTaskCalls[0]!.delegateUserId, null);
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

test('+Проект текст @делегат → createTask в inbox с delegateUserId + сообщение делегату с кнопками', async () => {
  const h = makeHarness();
  await h.service.startFromMessage(111, 500, '+Альфа Обнови билд @Вася');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`tc:${draftId}`));
  assert.equal(h.createTaskCalls[0]!.projectId, 'inbox1'); // делегирование — только inbox
  assert.equal(h.createTaskCalls[0]!.delegateUserId, 'u2');
  assert.equal(h.delegateMessages.length, 1);
  assert.equal(h.delegateMessages[0]!.userId, 'u2');
  assert.ok(h.delegateMessages[0]!.hasButtons); // Принять/Отказать
  // intended project сохранён в confirmed-черновике для переноса на accept.
  const d = h.drafts.get(draftId)!;
  assert.equal(d.status, 'confirmed');
  assert.equal(d.delegationId, 'del1');
  assert.equal(d.projectId, 'p1');
});

test('+многословный проект → жадный матч имени, остаток = текст', async () => {
  const h = makeHarness({ projects: [{ id: 'p1', name: 'Ралф core' }] });
  await h.service.startFromMessage(111, 500, '+Ралф core Обнови билд');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`tc:${draftId}`));
  assert.equal(h.createTaskCalls[0]!.projectId, 'p1');
  assert.equal(h.createTaskCalls[0]!.description, 'Обнови билд');
});

test('accept (da:) → accept.execute + перенос в проект (делегат — участник)', async () => {
  const h = makeHarness();
  await h.service.startFromMessage(111, 500, '+Альфа Обнови билд @Вася');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`tc:${draftId}`)); // создаёт делегирование del1
  // Делегат (tgUserId=222 → u2) принимает.
  await h.service.handleCallback(cq('da:del1', 222));
  assert.deepEqual(h.accepted, ['del1']);
  assert.equal(h.assigned.length, 1);
  assert.equal(h.assigned[0]!.projectId, 'p1');
});

test('decline (dd:) → decline.execute', async () => {
  const h = makeHarness();
  await h.service.startFromMessage(111, 500, '+Альфа Обнови билд @Вася');
  const draftId = [...h.drafts.keys()][0]!;
  await h.service.handleCallback(cq(`tc:${draftId}`));
  await h.service.handleCallback(cq('dd:del1', 222));
  assert.deepEqual(h.declined, ['del1']);
  assert.equal(h.assigned.length, 0);
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

test('AI: сегмент с исполнителем → задача в проекте + делегирование с кнопками', async () => {
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
  assert.equal(h.createTaskCalls[0]!.delegateUserId, 'u2');
  assert.equal(h.delegateMessages.length, 1);
  assert.ok(h.delegateMessages[0]!.hasButtons);
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
