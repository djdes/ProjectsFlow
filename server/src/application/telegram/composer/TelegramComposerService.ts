import type {
  TelegramClient,
  InlineKeyboardMarkup,
  InlineQueryResultArticle,
} from '../TelegramClient.js';
import type {
  TelegramTaskDraft,
  TelegramTaskDraftRepository,
  TelegramDraftOffered,
} from '../TelegramTaskDraftRepository.js';
import type { TelegramTaskMessageRepository } from '../TelegramTaskMessageRepository.js';
import type { SendAgentTelegramNotification } from '../SendAgentTelegramNotification.js';
import type { ProjectMemberRepository } from '../../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../../project/ProjectRepository.js';
import type { UserRepository } from '../../user/UserRepository.js';
import type { CreateTask } from '../../task/CreateTask.js';
import type { GetOrCreateInbox } from '../../project/GetOrCreateInbox.js';
import type { AcceptTaskDelegation } from '../../task/AcceptTaskDelegation.js';
import type { DeclineTaskDelegation } from '../../task/DeclineTaskDelegation.js';
import type { AssignInboxTaskToProject } from '../../task/AssignInboxTaskToProject.js';
import { parseComposerMessage } from './parseComposerMessage.js';
import { fuzzyMatch, greedyProjectPrefix } from './fuzzyMatch.js';

// Минимальный slice callback_query, который мы обрабатываем (см. TG Bot API #callbackquery).
export type TelegramCallbackQuery = {
  readonly id: string;
  readonly from: { readonly id: number };
  readonly message?: {
    readonly message_id: number;
    readonly chat: { readonly id: number };
  };
  readonly data?: string;
};

type Deps = {
  readonly drafts: TelegramTaskDraftRepository;
  readonly taskMessages: TelegramTaskMessageRepository;
  readonly members: ProjectMemberRepository;
  readonly projects: ProjectRepository;
  readonly users: UserRepository;
  readonly createTask: CreateTask;
  readonly getOrCreateInbox: GetOrCreateInbox;
  readonly accept: AcceptTaskDelegation;
  readonly decline: DeclineTaskDelegation;
  readonly assignToProject: AssignInboxTaskToProject;
  readonly sendNotification: SendAgentTelegramNotification;
  readonly client: TelegramClient;
  readonly idGen: () => string;
  readonly shortIdGen: () => string;
  readonly appUrl: string;
};

// composing-черновик живёт 30 мин; confirmed (делегирование) — долго, т.к. accept может
// прийти спустя часы, а нам нужен intended project_id для переноса на accept.
const DRAFT_TTL_SECONDS = 30 * 60;
const CONFIRMED_TTL_SECONDS = 30 * 24 * 60 * 60;
const PAGE_SIZE = 6; // кнопок-вариантов на страницу пикера
const EXCERPT_LIMIT = 120;

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

function excerpt(text: string, limit = EXCERPT_LIMIT): string {
  const s = text.trim().replace(/\s+/g, ' ');
  return s.length <= limit ? s : s.slice(0, limit - 1).trimEnd() + '…';
}

// --- callback_data ---------------------------------------------------------
// tp:<d>:<idx|i|?|pN>  td:<d>:<idx|n|pN>  tc:<d>  tx:<d>  da:<delegationId>  dd:<delegationId>
type ProjectSel =
  | { readonly type: 'idx'; readonly idx: number }
  | { readonly type: 'inbox' }
  | { readonly type: 'choose' }
  | { readonly type: 'page'; readonly page: number };
type DelegateSel =
  | { readonly type: 'idx'; readonly idx: number }
  | { readonly type: 'none' }
  | { readonly type: 'page'; readonly page: number };
type ParsedCallback =
  | { readonly kind: 'project'; readonly draftId: string; readonly sel: ProjectSel }
  | { readonly kind: 'delegate'; readonly draftId: string; readonly sel: DelegateSel }
  | { readonly kind: 'confirm'; readonly draftId: string }
  | { readonly kind: 'cancel'; readonly draftId: string }
  | { readonly kind: 'accept'; readonly delegationId: string }
  | { readonly kind: 'decline'; readonly delegationId: string }
  | null;

function parseCallback(data: string | undefined): ParsedCallback {
  if (!data) return null;
  const colon = data.indexOf(':');
  if (colon < 0) return null;
  const prefix = data.slice(0, colon);
  const rest = data.slice(colon + 1);
  switch (prefix) {
    case 'tp': {
      const [draftId, sel] = splitOnce(rest);
      if (!draftId || sel === null) return null;
      return { kind: 'project', draftId, sel: parseProjectSel(sel) };
    }
    case 'td': {
      const [draftId, sel] = splitOnce(rest);
      if (!draftId || sel === null) return null;
      return { kind: 'delegate', draftId, sel: parseDelegateSel(sel) };
    }
    case 'tc':
      return { kind: 'confirm', draftId: rest };
    case 'tx':
      return { kind: 'cancel', draftId: rest };
    case 'da':
      return { kind: 'accept', delegationId: rest };
    case 'dd':
      return { kind: 'decline', delegationId: rest };
    default:
      return null;
  }
}

function splitOnce(s: string): [string, string | null] {
  const i = s.indexOf(':');
  if (i < 0) return [s, null];
  return [s.slice(0, i), s.slice(i + 1)];
}

function parseProjectSel(sel: string): ProjectSel {
  if (sel === 'i') return { type: 'inbox' };
  if (sel === '?') return { type: 'choose' };
  if (sel.startsWith('p')) return { type: 'page', page: Math.max(0, Number(sel.slice(1)) || 0) };
  return { type: 'idx', idx: Math.max(0, Number(sel) || 0) };
}

function parseDelegateSel(sel: string): DelegateSel {
  if (sel === 'n') return { type: 'none' };
  if (sel.startsWith('p')) return { type: 'page', page: Math.max(0, Number(sel.slice(1)) || 0) };
  return { type: 'idx', idx: Math.max(0, Number(sel) || 0) };
}

// Очистка предложенных проектов/участников из offered (после выбора). null если пусто.
function clearProjects(o: TelegramDraftOffered | null): TelegramDraftOffered | null {
  if (!o?.members?.length) return null;
  return { members: o.members };
}
function clearMembers(o: TelegramDraftOffered | null): TelegramDraftOffered | null {
  if (!o?.projects?.length) return null;
  return { projects: o.projects };
}

type Card = { readonly text: string; readonly replyMarkup?: InlineKeyboardMarkup };

// Конструктор задач: парсит `+проект текст @делегат`, ведёт многошаговый выбор кнопками,
// создаёт задачу (и при наличии делегата — делегирует с кнопками Принять/Отказать).
export class TelegramComposerService {
  constructor(private readonly deps: Deps) {}

  // Точка входа из HandleTelegramWebhook: не-командное, не-reply сообщение → черновик задачи.
  async startFromMessage(tgUserId: number, chatId: number, rawText: string): Promise<void> {
    const userId = await this.deps.users.findUserIdByTelegramUserId(tgUserId);
    if (!userId) {
      await this.send(chatId, this.notLinkedText());
      return;
    }

    const parsed = parseComposerMessage(rawText);

    // Резолв проекта. taskText может быть переопределён жадным матчем многословного имени.
    let projectId: string | null = null; // null = «Входящие» (если решено)
    let offeredProjects: TelegramDraftOffered['projects'] | undefined;
    let taskText = parsed.taskText.trim();
    if (parsed.projectQuery !== null) {
      const all = (await this.deps.members.listProjectsForUser(userId)).filter((p) => !p.isInbox);
      // Сегмент «<проект> <текст>» для жадного матча многословных имён.
      const segment = [parsed.projectQuery, parsed.taskText].filter((s) => s.length > 0).join(' ');
      const greedy = greedyProjectPrefix(segment, all, (p) => p.name);
      if (greedy) {
        projectId = greedy.item.id;
        taskText = greedy.remainder.trim();
      } else {
        const r = fuzzyMatch(parsed.projectQuery, all, (p) => p.name);
        if (r.unique) {
          projectId = r.unique.id;
        } else {
          const list = r.matches.length > 0 ? r.matches : all;
          offeredProjects = list.map((p) => ({ id: p.id, name: p.name }));
        }
      }
    }

    if (taskText.length === 0) {
      await this.send(
        chatId,
        '📝 Напиши текст задачи. Например: <code>+Проект Обнови билд @Коллега</code> или просто текст — добавлю во «Входящие».',
      );
      return;
    }

    // Резолв делегата.
    let delegateUserId: string | null = null;
    let offeredMembers: TelegramDraftOffered['members'] | undefined;
    if (parsed.delegateQuery !== null) {
      const shared = await this.deps.members.listSharedUsers(userId);
      const r = fuzzyMatch(parsed.delegateQuery, shared, (u) => u.displayName);
      if (r.unique) {
        delegateUserId = r.unique.id;
      } else {
        const list = r.matches.length > 0 ? r.matches : shared;
        offeredMembers = list.map((u) => ({ id: u.id, displayName: u.displayName }));
      }
    }

    const offered: TelegramDraftOffered | null =
      offeredProjects || offeredMembers
        ? { ...(offeredProjects ? { projects: offeredProjects } : {}), ...(offeredMembers ? { members: offeredMembers } : {}) }
        : null;

    const draft = await this.deps.drafts.create({
      id: this.deps.shortIdGen(),
      creatorUserId: userId,
      tgChatId: chatId,
      taskText,
      projectId,
      delegateUserId,
      offered,
      ttlSeconds: DRAFT_TTL_SECONDS,
    });

    const card = await this.nextCard(draft);
    await this.send(chatId, card.text, card.replyMarkup);
  }

  // Phase D — inline-режим: `@ProjectsFlow_Bot текст задачи [@делегат]` показывает живой
  // список проектов. Выбор отправляет канонический `+<Проект> текст @делегат` в чат, который
  // затем проходит через тот же конструктор (startFromMessage) — без дублирования логики.
  async handleInlineQuery(inlineQueryId: string, tgUserId: number, query: string): Promise<void> {
    const userId = await this.deps.users.findUserIdByTelegramUserId(tgUserId);
    if (!userId) {
      // Не привязан → кнопка «открыть бота» ведёт на /start.
      await this.deps.client.answerInlineQuery({
        inlineQueryId,
        results: [],
        cacheTime: 0,
        isPersonal: true,
        switchPmText: 'Привязать аккаунт',
        switchPmParameter: 'link',
      });
      return;
    }

    const parsed = parseComposerMessage(query);
    const taskText = parsed.taskText.trim();
    const delegateSuffix = parsed.delegateQuery ? ` @${parsed.delegateQuery}` : '';
    const results: InlineQueryResultArticle[] = [];

    if (taskText.length === 0) {
      await this.deps.client.answerInlineQuery({
        inlineQueryId,
        results: [
          {
            type: 'article',
            id: 'hint',
            title: 'Напиши текст задачи…',
            description: 'Например: обнови билд @Коллега',
            input_message_content: { message_text: '/help' },
          },
        ],
        cacheTime: 0,
        isPersonal: true,
      });
      return;
    }

    // Вариант «Во Входящие».
    results.push({
      type: 'article',
      id: 'inbox',
      title: '📥 Во «Входящие»',
      description: taskText,
      input_message_content: { message_text: `${taskText}${delegateSuffix}` },
    });

    // По проекту на вариант (cap 8 — лимит inline-результатов держим скромным).
    const projects = (await this.deps.members.listProjectsForUser(userId)).filter((p) => !p.isInbox);
    for (const p of projects.slice(0, 8)) {
      results.push({
        type: 'article',
        id: `p:${p.id}`,
        title: `📁 ${p.name}`,
        description: taskText,
        input_message_content: { message_text: `+${p.name} ${taskText}${delegateSuffix}` },
      });
    }

    await this.deps.client.answerInlineQuery({
      inlineQueryId,
      results,
      cacheTime: 0,
      isPersonal: true,
    });
  }

  // Точка входа из HandleTelegramWebhook для callback_query (нажатия кнопок).
  async handleCallback(cq: TelegramCallbackQuery): Promise<void> {
    const cb = parseCallback(cq.data);
    if (!cb) {
      await this.deps.client.answerCallbackQuery(cq.id);
      return;
    }
    if (cb.kind === 'accept') return this.handleAccept(cq, cb.delegationId);
    if (cb.kind === 'decline') return this.handleDecline(cq, cb.delegationId);

    const draft = await this.deps.drafts.getById(cb.draftId);
    if (!draft) {
      await this.deps.client.answerCallbackQuery(cq.id, {
        text: 'Черновик истёк — начни заново.',
        showAlert: true,
      });
      return;
    }
    if (draft.status !== 'composing') {
      await this.deps.client.answerCallbackQuery(cq.id, { text: 'Этот черновик уже обработан.' });
      return;
    }
    const userId = await this.deps.users.findUserIdByTelegramUserId(cq.from.id);
    if (!userId || userId !== draft.creatorUserId) {
      await this.deps.client.answerCallbackQuery(cq.id, { text: 'Это не твой черновик.' });
      return;
    }

    const chatId = cq.message?.chat.id ?? draft.tgChatId;
    const messageId = cq.message?.message_id;

    switch (cb.kind) {
      case 'cancel': {
        await this.deps.drafts.patch(draft.id, { status: 'cancelled' });
        if (messageId) await this.edit(chatId, messageId, '✖️ Отменено.');
        await this.deps.client.answerCallbackQuery(cq.id, { text: 'Отменено' });
        return;
      }
      case 'project':
        return this.onProjectSel(cq, draft, userId, cb.sel, chatId, messageId);
      case 'delegate':
        return this.onDelegateSel(cq, draft, cb.sel, chatId, messageId);
      case 'confirm':
        return this.finalize(draft, userId, chatId, messageId, cq.id);
    }
  }

  private async onProjectSel(
    cq: TelegramCallbackQuery,
    draft: TelegramTaskDraft,
    userId: string,
    sel: ProjectSel,
    chatId: number,
    messageId: number | undefined,
  ): Promise<void> {
    if (sel.type === 'page') {
      if (messageId) {
        const card = this.renderProjectPicker(draft, sel.page);
        await this.edit(chatId, messageId, card.text, card.replyMarkup);
      }
      await this.deps.client.answerCallbackQuery(cq.id);
      return;
    }
    if (sel.type === 'choose') {
      // «Сменить проект» из карточки-подтверждения: предлагаем все проекты.
      const all = (await this.deps.members.listProjectsForUser(userId)).filter((p) => !p.isInbox);
      const offered: TelegramDraftOffered = {
        ...(draft.offered?.members ? { members: draft.offered.members } : {}),
        projects: all.map((p) => ({ id: p.id, name: p.name })),
      };
      const updated = await this.deps.drafts.patch(draft.id, { offered });
      if (updated && messageId) {
        const card = this.renderProjectPicker(updated, 0);
        await this.edit(chatId, messageId, card.text, card.replyMarkup);
      }
      await this.deps.client.answerCallbackQuery(cq.id);
      return;
    }
    let projectId: string | null;
    if (sel.type === 'inbox') {
      projectId = null;
    } else {
      projectId = draft.offered?.projects?.[sel.idx]?.id ?? null;
    }
    const updated = await this.deps.drafts.patch(draft.id, {
      projectId,
      offered: clearProjects(draft.offered),
    });
    await this.advance(cq, updated ?? draft, chatId, messageId);
  }

  private async onDelegateSel(
    cq: TelegramCallbackQuery,
    draft: TelegramTaskDraft,
    sel: DelegateSel,
    chatId: number,
    messageId: number | undefined,
  ): Promise<void> {
    if (sel.type === 'page') {
      if (messageId) {
        const card = this.renderMemberPicker(draft, sel.page);
        await this.edit(chatId, messageId, card.text, card.replyMarkup);
      }
      await this.deps.client.answerCallbackQuery(cq.id);
      return;
    }
    const delegateUserId =
      sel.type === 'none' ? null : (draft.offered?.members?.[sel.idx]?.id ?? null);
    const updated = await this.deps.drafts.patch(draft.id, {
      delegateUserId,
      offered: clearMembers(draft.offered),
    });
    await this.advance(cq, updated ?? draft, chatId, messageId);
  }

  // После выбора проекта/делегата — показать следующий шаг (пикер или подтверждение).
  private async advance(
    cq: TelegramCallbackQuery,
    draft: TelegramTaskDraft,
    chatId: number,
    messageId: number | undefined,
  ): Promise<void> {
    const card = await this.nextCard(draft);
    if (messageId) await this.edit(chatId, messageId, card.text, card.replyMarkup);
    await this.deps.client.answerCallbackQuery(cq.id);
  }

  private async finalize(
    draft: TelegramTaskDraft,
    userId: string,
    chatId: number,
    messageId: number | undefined,
    cqId: string,
  ): Promise<void> {
    const text = (draft.taskText ?? '').trim();
    if (text.length === 0) {
      await this.deps.drafts.patch(draft.id, { status: 'cancelled' });
      await this.deps.client.answerCallbackQuery(cqId, { text: 'Пустой текст задачи.', showAlert: true });
      return;
    }

    try {
      if (draft.delegateUserId) {
        // Делегирование возможно только для inbox-задач → создаём во «Входящие».
        const inbox = await this.deps.getOrCreateInbox.execute(userId);
        const task = await this.deps.createTask.execute({
          projectId: inbox.id,
          ownerUserId: userId,
          description: text,
          status: 'todo',
          delegateUserId: draft.delegateUserId,
        });
        const delegationId = task.delegation?.id ?? null;
        // confirmed-черновик живёт долго: на accept нужен intended project_id.
        await this.deps.drafts.patch(draft.id, {
          status: 'confirmed',
          delegationId,
          extendTtlSeconds: CONFIRMED_TTL_SECONDS,
        });
        if (messageId) {
          await this.deps.taskMessages.upsert({
            tgChatId: chatId,
            tgMessageId: messageId,
            recipientUserId: userId,
            taskId: task.id,
            projectId: inbox.id,
          });
        }
        await this.notifyDelegate(draft, task.id, inbox.id, delegationId, userId, text);

        const delegateName =
          (await this.deps.users.getById(draft.delegateUserId))?.displayName ?? 'участнику';
        const projName = draft.projectId
          ? ((await this.deps.projects.getById(draft.projectId))?.name ?? 'проект')
          : 'Входящие';
        if (messageId) {
          await this.edit(
            chatId,
            messageId,
            `✅ Задача делегирована <b>${escapeHtml(delegateName)}</b> (контекст: <b>${escapeHtml(projName)}</b>).\n📝 ${escapeHtml(excerpt(text))}\n\n⏳ Жду ответа: принять / отказать.`,
          );
        }
        await this.deps.client.answerCallbackQuery(cqId, { text: 'Делегировано' });
      } else {
        const targetId = draft.projectId ?? (await this.deps.getOrCreateInbox.execute(userId)).id;
        const task = await this.deps.createTask.execute({
          projectId: targetId,
          ownerUserId: userId,
          description: text,
          status: 'todo',
        });
        await this.deps.drafts.patch(draft.id, { status: 'confirmed' });
        if (messageId) {
          await this.deps.taskMessages.upsert({
            tgChatId: chatId,
            tgMessageId: messageId,
            recipientUserId: userId,
            taskId: task.id,
            projectId: targetId,
          });
        }
        const projName = draft.projectId
          ? ((await this.deps.projects.getById(targetId))?.name ?? 'проект')
          : 'Входящие';
        if (messageId) {
          await this.edit(
            chatId,
            messageId,
            `✅ Задача создана в <b>${escapeHtml(projName)}</b>.\n📝 ${escapeHtml(excerpt(text))}\n\n↩️ Ответь на это сообщение, чтобы добавить комментарий.`,
          );
        }
        await this.deps.client.answerCallbackQuery(cqId, { text: 'Создано' });
      }
    } catch (err) {
      console.warn('[tg-composer] finalize failed:', err);
      await this.deps.client.answerCallbackQuery(cqId, {
        text: 'Не удалось создать задачу. Попробуй через интерфейс ProjectsFlow.',
        showAlert: true,
      });
    }
  }

  private async notifyDelegate(
    draft: TelegramTaskDraft,
    taskId: string,
    inboxId: string,
    delegationId: string | null,
    creatorUserId: string,
    text: string,
  ): Promise<void> {
    if (!delegationId || !draft.delegateUserId) return;
    const creator = await this.deps.users.getById(creatorUserId);
    const creatorName = creator?.displayName ?? 'Коллега';
    const projName = draft.projectId
      ? ((await this.deps.projects.getById(draft.projectId))?.name ?? null)
      : null;
    const ctx = projName ? ` Проект: <b>${escapeHtml(projName)}</b>.` : ' (во «Входящие»).';
    const msg = `👤 <b>${escapeHtml(creatorName)}</b> делегирует тебе задачу:\n📝 <i>${escapeHtml(excerpt(text))}</i>.${ctx}`;
    const replyMarkup: InlineKeyboardMarkup = {
      inline_keyboard: [
        [
          { text: '✅ Принять', callback_data: `da:${delegationId}` },
          { text: '❌ Отказать', callback_data: `dd:${delegationId}` },
        ],
      ],
    };
    const res = await this.deps.sendNotification.execute({
      userId: draft.delegateUserId,
      text: msg,
      parseMode: 'HTML',
      kind: 'task_delegation',
      taskId,
      replyMarkup,
      skipPrefsCheck: true, // actionable — должен дойти независимо от prefs
      skipDedupCheck: true,
    });
    if (res.status === 'ok') {
      await this.deps.taskMessages.upsert({
        tgChatId: res.chatId,
        tgMessageId: res.messageId,
        recipientUserId: draft.delegateUserId,
        taskId,
        projectId: inboxId,
      });
    }
  }

  // --- Принять / Отказать (нажал делегат) ---
  private async handleAccept(cq: TelegramCallbackQuery, delegationId: string): Promise<void> {
    const userId = await this.deps.users.findUserIdByTelegramUserId(cq.from.id);
    if (!userId) {
      await this.deps.client.answerCallbackQuery(cq.id, { text: 'Сначала привяжи Telegram (/start).', showAlert: true });
      return;
    }
    const chatId = cq.message?.chat.id;
    const messageId = cq.message?.message_id;
    try {
      const delegation = await this.deps.accept.execute(delegationId, userId);
      // Если был назван проект и делегат — его участник, переносим задачу в проект
      // (иначе делегирование заархивируется и делегат потеряет доступ — оставляем в inbox).
      let movedInfo = '';
      const draft = await this.deps.drafts.getByDelegationId(delegationId);
      if (draft?.projectId) {
        const isMember = await this.deps.members.findForProject(draft.projectId, userId);
        if (isMember) {
          try {
            await this.deps.assignToProject.execute(
              delegation.taskId,
              draft.projectId,
              draft.creatorUserId,
            );
            const proj = await this.deps.projects.getById(draft.projectId);
            movedInfo = proj ? ` Задача перенесена в «${proj.name}».` : '';
          } catch (err) {
            console.warn('[tg-composer] assignToProject on accept failed:', err);
          }
        }
      }
      if (chatId && messageId) {
        await this.edit(chatId, messageId, `✅ Принято.${movedInfo}`);
      }
      await this.deps.client.answerCallbackQuery(cq.id, { text: 'Принято' });
      // TG-пинг создателю (in-app/email уже шлёт use-case; здесь — мгновенный TG).
      await this.pingCreator(delegation.creatorUserId, delegation.taskId,
        `✅ <b>${escapeHtml(delegation.delegateDisplayName)}</b> принял делегированную задачу.${movedInfo}`);
    } catch (err) {
      await this.answerDelegationError(cq.id, err);
    }
  }

  private async handleDecline(cq: TelegramCallbackQuery, delegationId: string): Promise<void> {
    const userId = await this.deps.users.findUserIdByTelegramUserId(cq.from.id);
    if (!userId) {
      await this.deps.client.answerCallbackQuery(cq.id, { text: 'Сначала привяжи Telegram (/start).', showAlert: true });
      return;
    }
    const chatId = cq.message?.chat.id;
    const messageId = cq.message?.message_id;
    try {
      const delegation = await this.deps.decline.execute(delegationId, userId);
      if (chatId && messageId) await this.edit(chatId, messageId, '❌ Ты отклонил задачу.');
      await this.deps.client.answerCallbackQuery(cq.id, { text: 'Отклонено' });
      await this.pingCreator(delegation.creatorUserId, delegation.taskId,
        `❌ <b>${escapeHtml(delegation.delegateDisplayName)}</b> отклонил делегированную задачу.`);
    } catch (err) {
      await this.answerDelegationError(cq.id, err);
    }
  }

  private async pingCreator(creatorUserId: string, taskId: string, text: string): Promise<void> {
    // Неизвестный kind → шлётся без pref-чека (это мгновенный статус-апдейт по действию).
    await this.deps.sendNotification
      .execute({ userId: creatorUserId, text, parseMode: 'HTML', kind: 'task_delegation_resolved', taskId })
      .catch(() => {});
  }

  private async answerDelegationError(cqId: string, err: unknown): Promise<void> {
    const name = err instanceof Error ? err.constructor.name : '';
    if (name === 'DelegationWrongStateError') {
      await this.deps.client.answerCallbackQuery(cqId, { text: 'Делегирование уже неактуально.', showAlert: true });
    } else if (name === 'NotDelegateError') {
      await this.deps.client.answerCallbackQuery(cqId, { text: 'Это делегирование адресовано не тебе.', showAlert: true });
    } else if (name === 'DelegationNotFoundError') {
      await this.deps.client.answerCallbackQuery(cqId, { text: 'Делегирование не найдено.', showAlert: true });
    } else {
      console.warn('[tg-composer] delegation action failed:', err);
      await this.deps.client.answerCallbackQuery(cqId, { text: 'Не удалось обработать. Попробуй через интерфейс.', showAlert: true });
    }
  }

  // --- Рендеринг карточек ---
  private async nextCard(draft: TelegramTaskDraft): Promise<Card> {
    if (draft.offered?.projects?.length) return this.renderProjectPicker(draft, 0);
    if (draft.offered?.members?.length) return this.renderMemberPicker(draft, 0);
    return this.renderConfirm(draft);
  }

  private renderProjectPicker(draft: TelegramTaskDraft, page: number): Card {
    const all = draft.offered?.projects ?? [];
    const rows = this.pageButtons(all.length, page, (absIdx) => ({
      text: all[absIdx]?.name.slice(0, 40) ?? '?',
      callback_data: `tp:${draft.id}:${absIdx}`,
    }));
    rows.push(...this.navRow(all.length, page, (p) => `tp:${draft.id}:p${p}`));
    rows.push([
      { text: '📥 Во «Входящие»', callback_data: `tp:${draft.id}:i` },
      { text: '✖️ Отмена', callback_data: `tx:${draft.id}` },
    ]);
    const hint = all.length === 0 ? '\nНе нашёл проект по запросу — выбери из списка.' : '';
    return {
      text: `🆕 <b>Новая задача</b>\n📝 ${escapeHtml(excerpt(draft.taskText ?? ''))}\n\n📁 В какой проект?${hint}`,
      replyMarkup: { inline_keyboard: rows },
    };
  }

  private renderMemberPicker(draft: TelegramTaskDraft, page: number): Card {
    const all = draft.offered?.members ?? [];
    const rows = this.pageButtons(all.length, page, (absIdx) => ({
      text: all[absIdx]?.displayName.slice(0, 40) ?? '?',
      callback_data: `td:${draft.id}:${absIdx}`,
    }));
    rows.push(...this.navRow(all.length, page, (p) => `td:${draft.id}:p${p}`));
    rows.push([
      { text: '🚫 Без делегирования', callback_data: `td:${draft.id}:n` },
      { text: '✖️ Отмена', callback_data: `tx:${draft.id}` },
    ]);
    return {
      text: `🆕 <b>Новая задача</b>\n📝 ${escapeHtml(excerpt(draft.taskText ?? ''))}\n\n👤 Кому делегировать?`,
      replyMarkup: { inline_keyboard: rows },
    };
  }

  private async renderConfirm(draft: TelegramTaskDraft): Promise<Card> {
    const projName = draft.projectId
      ? ((await this.deps.projects.getById(draft.projectId))?.name ?? 'проект')
      : 'Входящие';
    const delegateName = draft.delegateUserId
      ? ((await this.deps.users.getById(draft.delegateUserId))?.displayName ?? null)
      : null;
    const lines = [
      '🆕 <b>Новая задача</b>',
      `📁 Проект: <b>${escapeHtml(projName)}</b>`,
    ];
    if (delegateName) lines.push(`👤 Делегат: <b>${escapeHtml(delegateName)}</b>`);
    lines.push(`📝 ${escapeHtml(excerpt(draft.taskText ?? ''))}`);
    const createLabel = delegateName ? '✅ Создать и делегировать' : '✅ Создать';
    return {
      text: lines.join('\n'),
      replyMarkup: {
        inline_keyboard: [
          [
            { text: createLabel, callback_data: `tc:${draft.id}` },
            { text: '✖️ Отмена', callback_data: `tx:${draft.id}` },
          ],
          [{ text: '📁 Сменить проект', callback_data: `tp:${draft.id}:?` }],
        ],
      },
    };
  }

  // Кнопки-варианты текущей страницы (по 2 в ряд).
  private pageButtons(
    total: number,
    page: number,
    make: (absIdx: number) => { text: string; callback_data: string },
  ): { text: string; callback_data: string }[][] {
    const start = page * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, total);
    const rows: { text: string; callback_data: string }[][] = [];
    for (let i = start; i < end; i += 2) {
      const row = [make(i)];
      if (i + 1 < end) row.push(make(i + 1));
      rows.push(row);
    }
    return rows;
  }

  // Навигация ◀ ▶ если вариантов больше одной страницы.
  private navRow(
    total: number,
    page: number,
    makePage: (page: number) => string,
  ): { text: string; callback_data: string }[][] {
    const pages = Math.ceil(total / PAGE_SIZE);
    if (pages <= 1) return [];
    const row: { text: string; callback_data: string }[] = [];
    if (page > 0) row.push({ text: '◀', callback_data: makePage(page - 1) });
    row.push({ text: `${page + 1}/${pages}`, callback_data: makePage(page) });
    if (page < pages - 1) row.push({ text: '▶', callback_data: makePage(page + 1) });
    return [row];
  }

  private notLinkedText(): string {
    const profileUrl = `${this.deps.appUrl.replace(/\/$/, '')}/profile`;
    return `👋 Сначала привяжи аккаунт: открой <a href="${profileUrl}">${profileUrl}</a> и нажми «Login with Telegram», затем отправь /start.`;
  }

  private async send(chatId: number, text: string, replyMarkup?: InlineKeyboardMarkup): Promise<void> {
    await this.deps.client
      .sendMessage({ chatId, text, parseMode: 'HTML', disableWebPagePreview: true, replyMarkup })
      .catch((err: unknown) => console.warn('[tg-composer] send failed:', err));
  }

  private async edit(
    chatId: number,
    messageId: number,
    text: string,
    replyMarkup?: InlineKeyboardMarkup,
  ): Promise<void> {
    await this.deps.client.editMessageText({
      chatId,
      messageId,
      text,
      parseMode: 'HTML',
      disableWebPagePreview: true,
      replyMarkup,
    });
  }
}
