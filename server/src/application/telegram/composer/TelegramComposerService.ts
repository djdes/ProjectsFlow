import type {
  TelegramClient,
  InlineKeyboardMarkup,
  InlineQueryResultArticle,
} from '../TelegramClient.js';
import type {
  TelegramTaskDraft,
  TelegramTaskDraftRepository,
  TelegramDraftOffered,
  TelegramDraftSegment,
} from '../TelegramTaskDraftRepository.js';
import type { EnqueueAiPromptJob } from '../../ai-prompt/EnqueueAiPromptJob.js';
import type { WaitForAiPromptJob } from '../../ai-prompt/WaitForAiPromptJob.js';
import type { TelegramTaskMessageRepository } from '../TelegramTaskMessageRepository.js';
import type { SendAgentTelegramNotification } from '../SendAgentTelegramNotification.js';
import type { ProjectMemberRepository } from '../../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../../project/ProjectRepository.js';
import type { UserRepository } from '../../user/UserRepository.js';
import type { CreateTask } from '../../task/CreateTask.js';
import type { GetOrCreateInbox } from '../../project/GetOrCreateInbox.js';
import type { AcceptTaskDelegation } from '../../task/AcceptTaskDelegation.js';
import type { DeclineTaskDelegation } from '../../task/DeclineTaskDelegation.js';
import type { MoveTaskToProject } from '../../task/MoveTaskToProject.js';
import { parseComposerMessage } from './parseComposerMessage.js';
import { fuzzyMatch, greedyProjectPrefix } from './fuzzyMatch.js';
import { parseComposeSegments, type ParsedComposeSegment } from './parseComposeSegments.js';
import {
  VISIBLE_KANBAN_STATUSES,
  type VisibleKanbanStatus,
  type KanbanBoardSettings,
  resolveColumnLabel,
  isColumnHidden,
} from '../../../domain/kanban/KanbanSettings.js';
import { markdownToTelegramHtml } from '../telegramMarkdown.js';

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

// Контекст группового сообщения для гибрид-маршрутизации (см. spec
// 2026-07-08-telegram-group-multi-user-tasks-design). ownerUserId — владелец группы (null,
// если не привязана); senderName/groupTitle — для атрибуции задачи-фолбэка.
export type TelegramGroupContext = {
  readonly ownerUserId: string | null;
  readonly senderName: string;
  readonly groupTitle: string | null;
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
  readonly assignToProject: MoveTaskToProject;
  readonly sendNotification: SendAgentTelegramNotification;
  readonly client: TelegramClient;
  readonly idGen: () => string;
  readonly shortIdGen: () => string;
  readonly appUrl: string;
  // AI-перефраз сообщения в задачи (простой/быстрый compose pass-1). Best-effort: если
  // диспетчер офлайн / job упал / таймаут — конструктор откатывается на ручной флоу.
  readonly enqueueAiPromptJob: EnqueueAiPromptJob;
  readonly waitForAiPromptJob: WaitForAiPromptJob;
};

// composing-черновик по запросу владельца практически не истекает (~10 лет) — можно вернуться
// к карточке «Новая задача» когда угодно. confirmed (делегирование) — тоже долго.
const DRAFT_TTL_SECONDS = 3650 * 24 * 60 * 60;
const CONFIRMED_TTL_SECONDS = 3650 * 24 * 60 * 60;
const PAGE_SIZE = 6; // кнопок-вариантов на страницу пикера
const EXCERPT_LIMIT = 120;

// --- AI-перефраз (compose pass-1) ---
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL_MS = 2500;
const WAIT_TEXT = '⏳ Ожидайте, перефразирую…';
// compose-job long-poll: каждый WaitForAiPromptJob блокирует до ~50с; до 20 попыток ≈1000с
// (≈16 мин) — большой/длинный черновик у диспетчера может идти минуты (watchdog в ralph до
// 15 мин); НЕ бросаем раньше, иначе ложный таймаут. Цикл привязан к числу попыток, а НЕ к
// wall-clock — чтобы тест с мгновенным моком (null/таймаут) не уходил в busy-loop.
const COMPOSE_WAIT_MS = 50_000;
const COMPOSE_MAX_ATTEMPTS = 20;
const SEGMENT_TERMINAL = new Set<string>(['succeeded', 'failed', 'cancelled']);
const EDIT_BTNS_PER_ROW = 4; // кнопок «✏️ N» в ряд на многосегментной карточке

// --- Колонки канбана (выбор колонки/статуса при создании) ---
// Короткие коды для callback_data (64-байт лимит): статус ↔ 1-символьный код.
const STATUS_TO_CODE: Record<VisibleKanbanStatus, string> = {
  backlog: 'b',
  manual: 'm',
  todo: 't',
  done: 'd',
};
const CODE_TO_STATUS: Record<string, VisibleKanbanStatus> = {
  b: 'backlog',
  m: 'manual',
  t: 'todo',
  d: 'done',
};
// Дефолтная колонка при создании задачи из бота (ЧЕРНОВИКИ) — задача не уходит сразу в
// очередь воркера, пока пользователь не выберет «ВОРКЕР»/todo.
const DEFAULT_COLUMN: VisibleKanbanStatus = 'backlog';

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

function excerpt(text: string, limit = EXCERPT_LIMIT): string {
  const s = text.trim().replace(/\s+/g, ' ');
  return s.length <= limit ? s : s.slice(0, limit - 1).trimEnd() + '…';
}

// Markdown → чистый текст без сырых маркеров (**, `, _, ~): прогоняем через TG-конвертер и
// снимаем теги. Для вставки ВНУТРЬ <b>/<i> (заголовки), где вложенные теги сломали бы парсер.
function mdToPlain(s: string): string {
  return markdownToTelegramHtml(s).replace(/<\/?[^>]+>/g, '');
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
// AI-сегментные селекторы (с '?' = открыть пикер). Отдельны от ручных, чтобы не ломать
// существующие tp:/td: коллбэки ручного флоу.
type AiProjSel =
  | { readonly type: 'idx'; readonly idx: number }
  | { readonly type: 'inbox' }
  | { readonly type: 'open' }
  | { readonly type: 'page'; readonly page: number };
type AiDelSel =
  | { readonly type: 'idx'; readonly idx: number }
  | { readonly type: 'none' }
  | { readonly type: 'open' }
  | { readonly type: 'page'; readonly page: number };
type DeadlinePreset = 'today' | 'tomorrow' | 'none';
// Селектор колонки: '?' = открыть пикер, pick = выбран статус. Manual ещё имеет back (→ confirm).
type AiStatusSel = { readonly type: 'open' } | { readonly type: 'pick'; readonly status: VisibleKanbanStatus };
type ManStatusSel =
  | { readonly type: 'open' }
  | { readonly type: 'pick'; readonly status: VisibleKanbanStatus }
  | { readonly type: 'back' };
type ParsedCallback =
  | { readonly kind: 'project'; readonly draftId: string; readonly sel: ProjectSel }
  | { readonly kind: 'delegate'; readonly draftId: string; readonly sel: DelegateSel }
  | { readonly kind: 'confirm'; readonly draftId: string }
  | { readonly kind: 'cancel'; readonly draftId: string }
  | { readonly kind: 'accept'; readonly delegationId: string }
  | { readonly kind: 'decline'; readonly delegationId: string }
  // --- AI-сегменты (compose) ---
  | { readonly kind: 'seg-create'; readonly draftId: string }
  | { readonly kind: 'seg-edit'; readonly draftId: string; readonly seg: number }
  | { readonly kind: 'seg-back'; readonly draftId: string }
  | { readonly kind: 'seg-toggle'; readonly draftId: string; readonly seg: number }
  | {
      readonly kind: 'seg-deadline';
      readonly draftId: string;
      readonly seg: number;
      readonly preset: DeadlinePreset;
    }
  | { readonly kind: 'seg-project'; readonly draftId: string; readonly seg: number; readonly sel: AiProjSel }
  | { readonly kind: 'seg-delegate'; readonly draftId: string; readonly seg: number; readonly sel: AiDelSel }
  | { readonly kind: 'seg-status'; readonly draftId: string; readonly seg: number; readonly sel: AiStatusSel }
  | { readonly kind: 'man-status'; readonly draftId: string; readonly sel: ManStatusSel }
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
    // --- AI-сегменты ---
    case 'ac':
      return rest ? { kind: 'seg-create', draftId: rest } : null;
    case 'ab':
      return rest ? { kind: 'seg-back', draftId: rest } : null;
    case 'ae': {
      const [draftId, segStr] = rest.split(':');
      if (!draftId || segStr === undefined) return null;
      return { kind: 'seg-edit', draftId, seg: toIdx(segStr) };
    }
    case 'at': {
      const [draftId, segStr] = rest.split(':');
      if (!draftId || segStr === undefined) return null;
      return { kind: 'seg-toggle', draftId, seg: toIdx(segStr) };
    }
    case 'al': {
      const [draftId, segStr, preset] = rest.split(':');
      if (!draftId || segStr === undefined || preset === undefined) return null;
      const p: DeadlinePreset | null =
        preset === 'today' ? 'today' : preset === 'tom' ? 'tomorrow' : preset === 'none' ? 'none' : null;
      if (!p) return null;
      return { kind: 'seg-deadline', draftId, seg: toIdx(segStr), preset: p };
    }
    case 'ap': {
      const [draftId, segStr, sel] = rest.split(':');
      if (!draftId || segStr === undefined || sel === undefined) return null;
      return { kind: 'seg-project', draftId, seg: toIdx(segStr), sel: parseAiProjSel(sel) };
    }
    case 'ad': {
      const [draftId, segStr, sel] = rest.split(':');
      if (!draftId || segStr === undefined || sel === undefined) return null;
      return { kind: 'seg-delegate', draftId, seg: toIdx(segStr), sel: parseAiDelSel(sel) };
    }
    case 'as': {
      const [draftId, segStr, sel] = rest.split(':');
      if (!draftId || segStr === undefined || sel === undefined) return null;
      return { kind: 'seg-status', draftId, seg: toIdx(segStr), sel: parseAiStatusSel(sel) };
    }
    case 'ts': {
      const [draftId, sel] = rest.split(':');
      if (!draftId || sel === undefined) return null;
      return { kind: 'man-status', draftId, sel: parseManStatusSel(sel) };
    }
    default:
      return null;
  }
}

function parseAiStatusSel(sel: string): AiStatusSel {
  if (sel === '?') return { type: 'open' };
  const st = CODE_TO_STATUS[sel];
  return st ? { type: 'pick', status: st } : { type: 'open' };
}

function parseManStatusSel(sel: string): ManStatusSel {
  if (sel === '?') return { type: 'open' };
  if (sel === 'x') return { type: 'back' };
  const st = CODE_TO_STATUS[sel];
  return st ? { type: 'pick', status: st } : { type: 'back' };
}

function toIdx(s: string): number {
  return Math.max(0, Number(s) || 0);
}

function parseAiProjSel(sel: string): AiProjSel {
  if (sel === 'i') return { type: 'inbox' };
  if (sel === '?') return { type: 'open' };
  if (sel.startsWith('p')) return { type: 'page', page: Math.max(0, Number(sel.slice(1)) || 0) };
  return { type: 'idx', idx: Math.max(0, Number(sel) || 0) };
}

function parseAiDelSel(sel: string): AiDelSel {
  if (sel === 'n') return { type: 'none' };
  if (sel === '?') return { type: 'open' };
  if (sel.startsWith('p')) return { type: 'page', page: Math.max(0, Number(sel.slice(1)) || 0) };
  return { type: 'idx', idx: Math.max(0, Number(sel) || 0) };
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

  // Точка входа из HandleTelegramWebhook: не-командное, не-reply сообщение → задача.
  // Любое сообщение прогоняется через простой/быстрый AI-compose (перефраз + авто проект/
  // исполнитель/дедлайн); пока AI думает — «Ожидайте, перефразирую…» со спиннером. Если AI
  // недоступен (диспетчер офлайн / job упал / таймаут / битый JSON) — тихий откат на ручной
  // флоу. Все AI-вызовы best-effort: любая ошибка только логируется, бот остаётся рабочим.
  async startFromMessage(
    tgUserId: number,
    chatId: number,
    rawText: string,
    groupCtx?: TelegramGroupContext,
  ): Promise<void> {
    // Групповое сообщение: гибрид-развилка. «Как отправитель» → продолжаем обычным флоу ниже;
    // «во Входящие владельца» → мгновенная задача от лица владельца; «nudge» → просим привязать.
    if (groupCtx) {
      const route = await this.resolveGroupRouting(tgUserId, rawText, groupCtx.ownerUserId);
      if (route === 'owner-inbox') {
        // ownerUserId гарантированно задан, когда route === 'owner-inbox'.
        return this.createInOwnerInbox(groupCtx.ownerUserId as string, chatId, rawText, groupCtx);
      }
      if (route === 'nudge') return this.send(chatId, this.bindHintText());
      // route === 'self' → обычный флоу ниже (отправитель точно привязан).
    }

    const userId = await this.deps.users.findUserIdByTelegramUserId(tgUserId);
    if (!userId) {
      await this.send(chatId, this.notLinkedText());
      return;
    }

    const parsed = parseComposerMessage(rawText);
    // Нет текста задачи (например, один '+Проект') → ручной флоу покажет подсказку (без AI).
    if (parsed.taskText.trim().length === 0) {
      await this.manualFlow(userId, chatId, rawText);
      return;
    }

    let waitMsgId: number | null = null;
    let stopSpinner: (() => void) | null = null;
    // Как только AI-черновик создан — больше НЕ откатываемся на ручной флоу (иначе создадим
    // второй черновик). Падение на показе карточки после этого — только лог.
    let aiDraftDone = false;
    try {
      waitMsgId = await this.sendReturningId(chatId, WAIT_TEXT);
      const hint = await this.resolveProjectHint(userId, parsed);
      const aiText = this.buildAiText(hint.taskText, parsed.delegateQuery);
      const job = await this.deps.enqueueAiPromptJob.execute({
        userId,
        text: aiText,
        projectId: hint.projectId,
        mode: 'compose',
      });
      if (waitMsgId !== null) stopSpinner = this.startSpinner(chatId, waitMsgId);
      const parsedSegs = await this.pollCompose(userId, job.id);
      if (stopSpinner) {
        stopSpinner();
        stopSpinner = null;
      }
      const segments = this.toDraftSegments(parsedSegs, hint.projectId);
      const draft = await this.deps.drafts.create({
        id: this.deps.shortIdGen(),
        creatorUserId: userId,
        tgChatId: chatId,
        taskText: aiText,
        segments,
        ttlSeconds: DRAFT_TTL_SECONDS,
      });
      aiDraftDone = true;
      const card = await this.renderSegmentsCard(draft);
      await this.respond(chatId, waitMsgId, card.text, card.replyMarkup);
    } catch (err) {
      if (stopSpinner) stopSpinner();
      if (aiDraftDone) {
        console.warn('[tg-composer] AI карточка не показалась (черновик создан):', err);
        return;
      }
      console.warn('[tg-composer] AI compose failed → ручной флоу:', err);
      await this.manualFlow(userId, chatId, rawText, waitMsgId ?? undefined);
    }
  }

  // Гибрид-развилка для группового сообщения. Возвращает:
  //   'self'        — создавать «как отправитель» (обычный флоу с карточкой/кнопками);
  //   'owner-inbox' — уронить в «Входящие» владельца группы (владелец задан);
  //   'nudge'       — некому и не под кем создавать → попросить владельца привязать /start.
  private async resolveGroupRouting(
    tgUserId: number,
    rawText: string,
    ownerUserId: string | null,
  ): Promise<'self' | 'owner-inbox' | 'nudge'> {
    const senderUserId = await this.deps.users.findUserIdByTelegramUserId(tgUserId);
    if (senderUserId) {
      if (!ownerUserId) return 'self'; // владельца нет — падать некуда, не ломаем текущее
      if (senderUserId === ownerUserId) return 'self'; // владелец всегда «как отправитель»
      // Реальный коллаборатор: назван +Проект, участником которого отправитель является.
      const parsed = parseComposerMessage(rawText);
      if (parsed.projectQuery) {
        const hint = await this.resolveProjectHint(senderUserId, parsed);
        if (hint.projectId) return 'self';
      }
      return 'owner-inbox'; // привязан, но для этого пространства «чужой» → в Входящие владельца
    }
    // Отправитель не привязан.
    return ownerUserId ? 'owner-inbox' : 'nudge';
  }

  // Фолбэк: мгновенно создаём задачу в «Входящих» ВЛАДЕЛЬЦА группы (от его лица), с атрибуцией
  // автора-отправителя в описании. Без карточки/кнопок — их в группе жал бы не владелец-создатель.
  private async createInOwnerInbox(
    ownerUserId: string,
    chatId: number,
    rawText: string,
    groupCtx: TelegramGroupContext,
  ): Promise<void> {
    const body = rawText.trim();
    if (body.length === 0) return;
    try {
      const inbox = await this.deps.getOrCreateInbox.execute(ownerUserId);
      await this.deps.createTask.execute({
        projectId: inbox.id,
        ownerUserId,
        description: this.buildOwnerInboxDescription(body, groupCtx),
        status: DEFAULT_COLUMN,
      });
      await this.send(
        chatId,
        `✅ Добавил в «Входящие»: <i>${escapeHtml(excerpt(body))}</i>\n<i>Поставил: ${escapeHtml(groupCtx.senderName)}</i>`,
      );
    } catch (err) {
      console.warn('[tg-composer] owner-inbox create failed:', err);
      await this.send(chatId, '❌ Не удалось создать задачу. Попробуйте позже.');
    }
  }

  // Текст задачи-фолбэка + футер-атрибуция (кто и из какой группы поставил).
  private buildOwnerInboxDescription(body: string, groupCtx: TelegramGroupContext): string {
    const grp = groupCtx.groupTitle ? ` · «${groupCtx.groupTitle}»` : '';
    return `${body}\n\n— 📨 из Telegram${grp}: ${groupCtx.senderName}`;
  }

  private bindHintText(): string {
    return '👋 Чтобы задачи от участников попадали в нужный аккаунт, владелец должен один раз отправить здесь /start.';
  }

  // Ручной флоу (без AI): парсит `+проект текст @делегат`, ведёт многошаговый выбор кнопками.
  // waitMsgId — если задан (осталось сообщение «Ожидайте…» от AI-попытки), первую карточку
  // рендерим редактированием этого сообщения, иначе шлём новое.
  private async manualFlow(
    userId: string,
    chatId: number,
    rawText: string,
    waitMsgId?: number,
  ): Promise<void> {
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
      await this.respond(
        chatId,
        waitMsgId ?? null,
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
    await this.respond(chatId, waitMsgId ?? null, card.text, card.replyMarkup);
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
      // --- AI-сегменты (compose) ---
      case 'seg-create':
        return this.finalizeSegments(draft, userId, chatId, messageId, cq.id);
      case 'seg-edit':
        return this.onSegEdit(cq, draft, cb.seg, chatId, messageId);
      case 'seg-back':
        return this.onSegBack(cq, draft, chatId, messageId);
      case 'seg-toggle':
        return this.onSegToggle(cq, draft, cb.seg, chatId, messageId);
      case 'seg-deadline':
        return this.onSegDeadline(cq, draft, cb.seg, cb.preset, chatId, messageId);
      case 'seg-project':
        return this.onSegProject(cq, draft, userId, cb.seg, cb.sel, chatId, messageId);
      case 'seg-delegate':
        return this.onSegDelegate(cq, draft, userId, cb.seg, cb.sel, chatId, messageId);
      case 'seg-status':
        return this.onSegStatus(cq, draft, cb.seg, cb.sel, chatId, messageId);
      case 'man-status':
        return this.onManStatus(cq, draft, cb.sel, chatId, messageId);
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
          status: draft.targetStatus ?? DEFAULT_COLUMN,
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
            `✅ Задача делегирована <b>${escapeHtml(delegateName)}</b> (контекст: <b>${escapeHtml(projName)}</b>).\n📝 ${markdownToTelegramHtml(excerpt(text))}\n\n⏳ Жду ответа: принять / отказать.`,
          );
        }
        await this.deps.client.answerCallbackQuery(cqId, { text: 'Делегировано' });
      } else {
        const targetId = draft.projectId ?? (await this.deps.getOrCreateInbox.execute(userId)).id;
        const task = await this.deps.createTask.execute({
          projectId: targetId,
          ownerUserId: userId,
          description: text,
          status: draft.targetStatus ?? DEFAULT_COLUMN,
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
            `✅ Задача создана в <b>${escapeHtml(projName)}</b>.\n📝 ${markdownToTelegramHtml(excerpt(text))}\n\n↩️ Ответь на это сообщение, чтобы добавить комментарий.`,
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
    const msg = `👤 <b>${escapeHtml(creatorName)}</b> делегирует тебе задачу:\n📝 <i>${mdToPlain(excerpt(text))}</i>.${ctx}`;
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
      text: `🆕 <b>Новая задача</b>\n📝 ${markdownToTelegramHtml(excerpt(draft.taskText ?? ''))}\n\n📁 В какой проект?${hint}`,
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
      text: `🆕 <b>Новая задача</b>\n📝 ${markdownToTelegramHtml(excerpt(draft.taskText ?? ''))}\n\n👤 Кому делегировать?`,
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
    const columnName = await this.columnLabelFor(draft.projectId, draft.targetStatus);
    const lines = [
      '🆕 <b>Новая задача</b>',
      `📁 Проект: <b>${escapeHtml(projName)}</b>`,
      `📊 Колонка: <b>${escapeHtml(columnName)}</b>`,
    ];
    if (delegateName) lines.push(`👤 Делегат: <b>${escapeHtml(delegateName)}</b>`);
    lines.push(`📝 ${markdownToTelegramHtml(excerpt(draft.taskText ?? ''))}`);
    const createLabel = delegateName ? '✅ Создать и делегировать' : '✅ Создать';
    return {
      text: lines.join('\n'),
      replyMarkup: {
        inline_keyboard: [
          [
            { text: createLabel, callback_data: `tc:${draft.id}` },
            { text: '✖️ Отмена', callback_data: `tx:${draft.id}` },
          ],
          [
            { text: '📁 Сменить проект', callback_data: `tp:${draft.id}:?` },
            { text: '📊 Колонка', callback_data: `ts:${draft.id}:?` },
          ],
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

  // ========================= AI-перефраз (compose) =========================

  // Однозначный проект-хинт из `+Проект` (для AI задаёт контекст и пинит сегменты).
  // Возвращает projectId (null если не указан/неоднозначен) и очищенный текст задачи.
  private async resolveProjectHint(
    userId: string,
    parsed: { projectQuery: string | null; taskText: string },
  ): Promise<{ projectId: string | null; taskText: string }> {
    const taskText = parsed.taskText.trim();
    if (parsed.projectQuery === null) return { projectId: null, taskText };
    const all = (await this.deps.members.listProjectsForUser(userId)).filter((p) => !p.isInbox);
    const segment = [parsed.projectQuery, parsed.taskText].filter((s) => s.length > 0).join(' ');
    const greedy = greedyProjectPrefix(segment, all, (p) => p.name);
    if (greedy) return { projectId: greedy.item.id, taskText: greedy.remainder.trim() };
    const r = fuzzyMatch(parsed.projectQuery, all, (p) => p.name);
    if (r.unique) return { projectId: r.unique.id, taskText };
    return { projectId: null, taskText };
  }

  // Текст для AI: задача + (если в `@делегат` назван исполнитель) явная подсказка модели.
  private buildAiText(taskText: string, delegateQuery: string | null): string {
    const t = taskText.trim();
    if (delegateQuery && delegateQuery.trim().length > 0) {
      return `${t}\n\nИсполнитель: ${delegateQuery.trim()}`;
    }
    return t;
  }

  // Опрос compose-job: до COMPOSE_MAX_ATTEMPTS long-poll'ов (≈150с в проде; в тестах мок
  // мгновенный). Бросает на не-succeeded / пустом / битом JSON → caller откатится на ручной.
  private async pollCompose(userId: string, jobId: string): Promise<ParsedComposeSegment[]> {
    let job: Awaited<ReturnType<WaitForAiPromptJob['execute']>> = null;
    for (let i = 0; i < COMPOSE_MAX_ATTEMPTS; i++) {
      job = await this.deps.waitForAiPromptJob.execute({ userId, jobId, maxWaitMs: COMPOSE_WAIT_MS });
      if (job && SEGMENT_TERMINAL.has(job.status)) break;
    }
    if (!job || job.status !== 'succeeded' || !job.improvedText) {
      throw new Error(`compose job not ready: ${job?.status ?? 'timeout'}`);
    }
    return parseComposeSegments(job.improvedText);
  }

  // Парсинг-результат → доменные сегменты черновика. hintProjectId (если задан +Проектом)
  // пинит все сегменты в этот проект (исполнителя оставляем — провалидируется при создании).
  private toDraftSegments(
    parsed: ParsedComposeSegment[],
    hintProjectId: string | null,
  ): TelegramDraftSegment[] {
    return parsed.map((s) => ({
      title: s.title,
      body: s.body,
      projectId: hintProjectId ?? s.projectId,
      projectName: hintProjectId ? null : s.projectName,
      assigneeUserId: s.assigneeUserId,
      assigneeName: s.assigneeName,
      deadline: s.deadline,
      included: true,
      targetStatus: null, // дефолт 'backlog' (ЧЕРНОВИКИ) пока пользователь не выбрал колонку
    }));
  }

  private async projNameOf(projectId: string | null): Promise<string> {
    if (!projectId) return 'Входящие';
    return (await this.deps.projects.getById(projectId))?.name ?? 'проект';
  }

  // --- Колонки канбана конкретного проекта ---
  private async kanbanSettingsOf(projectId: string | null): Promise<KanbanBoardSettings | null> {
    if (!projectId) return null; // «Входящие»/без проекта → встроенные дефолты
    try {
      return await this.deps.projects.getKanbanSettings(projectId);
    } catch (err) {
      console.warn('[tg-composer] getKanbanSettings failed:', err);
      return null;
    }
  }

  // Видимые колонки проекта (статус+код+подпись) в фикс-порядке backlog→manual→todo→done.
  // Скрытые (hidden) пропускаем, как на доске; backlog оставляем всегда (это дефолт-фолбэк).
  private columnOptions(
    settings: KanbanBoardSettings | null,
  ): { status: VisibleKanbanStatus; code: string; label: string }[] {
    const out: { status: VisibleKanbanStatus; code: string; label: string }[] = [];
    for (const status of VISIBLE_KANBAN_STATUSES) {
      const per = settings?.[status];
      if (status !== 'backlog' && isColumnHidden(per)) continue;
      out.push({ status, code: STATUS_TO_CODE[status], label: resolveColumnLabel(per, status) });
    }
    return out;
  }

  // Подпись выбранной (или дефолтной backlog) колонки под нужный проект.
  private async columnLabelFor(
    projectId: string | null,
    status: VisibleKanbanStatus | null,
  ): Promise<string> {
    const s = status ?? DEFAULT_COLUMN;
    const settings = await this.kanbanSettingsOf(projectId);
    return resolveColumnLabel(settings?.[s], s);
  }

  // Имя исполнителя для показа: по userId (если сматчился) или сырое имя-подсказка из текста.
  private async assigneeLabelOf(seg: TelegramDraftSegment): Promise<string | null> {
    if (seg.assigneeUserId) {
      return (
        (await this.deps.users.getById(seg.assigneeUserId))?.displayName ??
        seg.assigneeName ??
        'исполнитель'
      );
    }
    return seg.assigneeName;
  }

  // Главная карточка после перефраза: 1 сегмент → одиночная, N → сводная.
  private async renderSegmentsCard(draft: TelegramTaskDraft): Promise<Card> {
    const segs = draft.segments ?? [];
    if (segs.length <= 1) return this.renderSingleSegment(draft);
    return this.renderMultiSegment(draft);
  }

  private async renderSingleSegment(draft: TelegramTaskDraft): Promise<Card> {
    const seg = draft.segments?.[0];
    if (!seg) return this.renderConfirm(draft); // защитный фолбэк
    const projName = await this.projNameOf(seg.projectId);
    const assignee = await this.assigneeLabelOf(seg);
    const columnName = await this.columnLabelFor(seg.projectId, seg.targetStatus);
    const lines = ['🆕 <b>Новая задача</b>', `📁 Проект: <b>${escapeHtml(projName)}</b>`];
    if (assignee) lines.push(`👤 Исполнитель: <b>${escapeHtml(assignee)}</b>`);
    lines.push(`📊 Колонка: <b>${escapeHtml(columnName)}</b>`);
    if (seg.deadline) lines.push(`📅 Срок: <b>${escapeHtml(seg.deadline)}</b>`);
    if (seg.title.trim()) lines.push(`📝 <b>${mdToPlain(seg.title.trim())}</b>`);
    lines.push(markdownToTelegramHtml(excerpt(seg.body)));
    return {
      text: lines.join('\n'),
      replyMarkup: {
        inline_keyboard: [
          [
            { text: '✅ Создать задачу', callback_data: `ac:${draft.id}` },
            { text: '✖️ Отменить', callback_data: `tx:${draft.id}` },
          ],
          [{ text: '✏️ Изменить', callback_data: `ae:${draft.id}:0` }],
        ],
      },
    };
  }

  private async renderMultiSegment(draft: TelegramTaskDraft): Promise<Card> {
    const segs = draft.segments ?? [];
    const includedCount = segs.filter((s) => s.included).length;
    const lines = [`🆕 <b>Распознал задач: ${segs.length}</b>`, ''];
    // Кэш kanban-настроек в пределах ОДНОГО рендера (function-local, без гонок при
    // конкурентной обработке) — дедупит getKanbanSettings для сегментов одного проекта.
    const settingsCache = new Map<string, KanbanBoardSettings | null>();
    const settingsFor = async (pid: string | null): Promise<KanbanBoardSettings | null> => {
      if (!pid) return null;
      if (!settingsCache.has(pid)) settingsCache.set(pid, await this.kanbanSettingsOf(pid));
      return settingsCache.get(pid) ?? null;
    };
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (!seg) continue;
      const projName = await this.projNameOf(seg.projectId);
      const assignee = await this.assigneeLabelOf(seg);
      const colStatus = seg.targetStatus ?? DEFAULT_COLUMN;
      const columnName = resolveColumnLabel((await settingsFor(seg.projectId))?.[colStatus], colStatus);
      const meta = [`📁 ${escapeHtml(projName)}`, `📊 ${escapeHtml(columnName)}`];
      if (assignee) meta.push(`👤 ${escapeHtml(assignee)}`);
      meta.push(`📅 ${seg.deadline ? escapeHtml(seg.deadline) : '—'}`);
      const titleText = seg.title.trim() || excerpt(seg.body, 60);
      const strike = seg.included ? '' : ' <i>(исключена)</i>';
      lines.push(`${i + 1}. ${seg.included ? '' : '🚫 '}<b>${mdToPlain(titleText)}</b>${strike}`);
      lines.push(`   ${meta.join(' · ')}`);
    }
    const rows: { text: string; callback_data: string }[][] = [
      [
        { text: `✅ Создать все (${includedCount})`, callback_data: `ac:${draft.id}` },
        { text: '✖️ Отменить', callback_data: `tx:${draft.id}` },
      ],
    ];
    let row: { text: string; callback_data: string }[] = [];
    for (let i = 0; i < segs.length; i++) {
      row.push({ text: `✏️ ${i + 1}`, callback_data: `ae:${draft.id}:${i}` });
      if (row.length === EDIT_BTNS_PER_ROW) {
        rows.push(row);
        row = [];
      }
    }
    if (row.length > 0) rows.push(row);
    return { text: lines.join('\n'), replyMarkup: { inline_keyboard: rows } };
  }

  // Под-карточка правки одного сегмента (проект / исполнитель / срок / включение).
  private async renderSegmentEdit(draft: TelegramTaskDraft, idx: number): Promise<Card> {
    const segs = draft.segments ?? [];
    const seg = segs[idx];
    if (!seg) return this.renderSegmentsCard(draft);
    const multi = segs.length > 1;
    const projName = await this.projNameOf(seg.projectId);
    const assignee = await this.assigneeLabelOf(seg);
    const columnName = await this.columnLabelFor(seg.projectId, seg.targetStatus);
    const lines = [
      `✏️ <b>Задача ${idx + 1}</b>`,
      `📁 Проект: <b>${escapeHtml(projName)}</b>`,
      `📊 Колонка: <b>${escapeHtml(columnName)}</b>`,
      `👤 Исполнитель: <b>${assignee ? escapeHtml(assignee) : '—'}</b>`,
      `📅 Срок: <b>${seg.deadline ? escapeHtml(seg.deadline) : '—'}</b>`,
      '',
      `📝 ${markdownToTelegramHtml(excerpt(seg.body))}`,
    ];
    if (!seg.included) lines.push('\n🚫 <i>Исключена из создания</i>');
    const rows: { text: string; callback_data: string }[][] = [
      [
        { text: '📁 Проект', callback_data: `ap:${draft.id}:${idx}:?` },
        { text: '👤 Исполнитель', callback_data: `ad:${draft.id}:${idx}:?` },
      ],
      [{ text: '📊 Колонка', callback_data: `as:${draft.id}:${idx}:?` }],
      [
        { text: '📅 Сегодня', callback_data: `al:${draft.id}:${idx}:today` },
        { text: 'Завтра', callback_data: `al:${draft.id}:${idx}:tom` },
        { text: 'Без срока', callback_data: `al:${draft.id}:${idx}:none` },
      ],
    ];
    if (multi) {
      rows.push([
        {
          text: seg.included ? '🗑 Исключить' : '↩️ Вернуть',
          callback_data: `at:${draft.id}:${idx}`,
        },
      ]);
    }
    rows.push([{ text: '⬅️ Назад', callback_data: `ab:${draft.id}` }]);
    return { text: lines.join('\n'), replyMarkup: { inline_keyboard: rows } };
  }

  private renderAiProjectPicker(draft: TelegramTaskDraft, idx: number, page: number): Card {
    const all = draft.offered?.projects ?? [];
    const rows = this.pageButtons(all.length, page, (absIdx) => ({
      text: all[absIdx]?.name.slice(0, 40) ?? '?',
      callback_data: `ap:${draft.id}:${idx}:${absIdx}`,
    }));
    rows.push(...this.navRow(all.length, page, (p) => `ap:${draft.id}:${idx}:p${p}`));
    rows.push([
      { text: '📥 Во «Входящие»', callback_data: `ap:${draft.id}:${idx}:i` },
      { text: '⬅️ Назад', callback_data: `ae:${draft.id}:${idx}` },
    ]);
    return { text: `📁 Проект для задачи ${idx + 1}?`, replyMarkup: { inline_keyboard: rows } };
  }

  private renderAiMemberPicker(draft: TelegramTaskDraft, idx: number, page: number): Card {
    const all = draft.offered?.members ?? [];
    const rows = this.pageButtons(all.length, page, (absIdx) => ({
      text: all[absIdx]?.displayName.slice(0, 40) ?? '?',
      callback_data: `ad:${draft.id}:${idx}:${absIdx}`,
    }));
    rows.push(...this.navRow(all.length, page, (p) => `ad:${draft.id}:${idx}:p${p}`));
    rows.push([
      { text: '🚫 Без исполнителя', callback_data: `ad:${draft.id}:${idx}:n` },
      { text: '⬅️ Назад', callback_data: `ae:${draft.id}:${idx}` },
    ]);
    return { text: `👤 Исполнитель для задачи ${idx + 1}?`, replyMarkup: { inline_keyboard: rows } };
  }

  private async onSegEdit(
    cq: TelegramCallbackQuery,
    draft: TelegramTaskDraft,
    idx: number,
    chatId: number,
    messageId: number | undefined,
  ): Promise<void> {
    const card = await this.renderSegmentEdit(draft, idx);
    if (messageId) await this.edit(chatId, messageId, card.text, card.replyMarkup);
    await this.deps.client.answerCallbackQuery(cq.id);
  }

  private async onSegBack(
    cq: TelegramCallbackQuery,
    draft: TelegramTaskDraft,
    chatId: number,
    messageId: number | undefined,
  ): Promise<void> {
    const card = await this.renderSegmentsCard(draft);
    if (messageId) await this.edit(chatId, messageId, card.text, card.replyMarkup);
    await this.deps.client.answerCallbackQuery(cq.id);
  }

  private async onSegToggle(
    cq: TelegramCallbackQuery,
    draft: TelegramTaskDraft,
    idx: number,
    chatId: number,
    messageId: number | undefined,
  ): Promise<void> {
    const segs = (draft.segments ?? []).slice();
    const seg = segs[idx];
    if (seg) {
      segs[idx] = { ...seg, included: !seg.included };
      const updated = await this.deps.drafts.patch(draft.id, { segments: segs });
      const card = await this.renderSegmentEdit(updated ?? draft, idx);
      if (messageId) await this.edit(chatId, messageId, card.text, card.replyMarkup);
    }
    await this.deps.client.answerCallbackQuery(cq.id);
  }

  private async onSegDeadline(
    cq: TelegramCallbackQuery,
    draft: TelegramTaskDraft,
    idx: number,
    preset: DeadlinePreset,
    chatId: number,
    messageId: number | undefined,
  ): Promise<void> {
    const segs = (draft.segments ?? []).slice();
    const seg = segs[idx];
    if (seg) {
      const deadline = preset === 'none' ? null : this.presetDate(preset);
      segs[idx] = { ...seg, deadline };
      const updated = await this.deps.drafts.patch(draft.id, { segments: segs });
      const card = await this.renderSegmentEdit(updated ?? draft, idx);
      if (messageId) await this.edit(chatId, messageId, card.text, card.replyMarkup);
    }
    await this.deps.client.answerCallbackQuery(cq.id);
  }

  private presetDate(preset: 'today' | 'tomorrow'): string {
    const d = new Date();
    if (preset === 'tomorrow') d.setDate(d.getDate() + 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private async onSegProject(
    cq: TelegramCallbackQuery,
    draft: TelegramTaskDraft,
    userId: string,
    idx: number,
    sel: AiProjSel,
    chatId: number,
    messageId: number | undefined,
  ): Promise<void> {
    if (sel.type === 'open') {
      const all = (await this.deps.members.listProjectsForUser(userId)).filter((p) => !p.isInbox);
      const offered: TelegramDraftOffered = {
        ...(draft.offered?.members ? { members: draft.offered.members } : {}),
        projects: all.map((p) => ({ id: p.id, name: p.name })),
      };
      const updated = await this.deps.drafts.patch(draft.id, { offered });
      if (messageId) {
        const card = this.renderAiProjectPicker(updated ?? draft, idx, 0);
        await this.edit(chatId, messageId, card.text, card.replyMarkup);
      }
      await this.deps.client.answerCallbackQuery(cq.id);
      return;
    }
    if (sel.type === 'page') {
      if (messageId) {
        const card = this.renderAiProjectPicker(draft, idx, sel.page);
        await this.edit(chatId, messageId, card.text, card.replyMarkup);
      }
      await this.deps.client.answerCallbackQuery(cq.id);
      return;
    }
    const segs = (draft.segments ?? []).slice();
    const seg = segs[idx];
    if (seg) {
      let projectId: string | null;
      let projectName: string | null;
      if (sel.type === 'inbox') {
        projectId = null;
        projectName = null;
      } else {
        const picked = draft.offered?.projects?.[sel.idx];
        projectId = picked?.id ?? seg.projectId;
        projectName = picked?.name ?? seg.projectName;
      }
      segs[idx] = { ...seg, projectId, projectName };
      const updated = await this.deps.drafts.patch(draft.id, {
        segments: segs,
        offered: clearProjects(draft.offered),
      });
      const card = await this.renderSegmentEdit(updated ?? draft, idx);
      if (messageId) await this.edit(chatId, messageId, card.text, card.replyMarkup);
    }
    await this.deps.client.answerCallbackQuery(cq.id);
  }

  private async onSegDelegate(
    cq: TelegramCallbackQuery,
    draft: TelegramTaskDraft,
    userId: string,
    idx: number,
    sel: AiDelSel,
    chatId: number,
    messageId: number | undefined,
  ): Promise<void> {
    if (sel.type === 'open') {
      const shared = await this.deps.members.listSharedUsers(userId);
      const offered: TelegramDraftOffered = {
        ...(draft.offered?.projects ? { projects: draft.offered.projects } : {}),
        members: shared.map((u) => ({ id: u.id, displayName: u.displayName })),
      };
      const updated = await this.deps.drafts.patch(draft.id, { offered });
      if (messageId) {
        const card = this.renderAiMemberPicker(updated ?? draft, idx, 0);
        await this.edit(chatId, messageId, card.text, card.replyMarkup);
      }
      await this.deps.client.answerCallbackQuery(cq.id);
      return;
    }
    if (sel.type === 'page') {
      if (messageId) {
        const card = this.renderAiMemberPicker(draft, idx, sel.page);
        await this.edit(chatId, messageId, card.text, card.replyMarkup);
      }
      await this.deps.client.answerCallbackQuery(cq.id);
      return;
    }
    const segs = (draft.segments ?? []).slice();
    const seg = segs[idx];
    if (seg) {
      let assigneeUserId: string | null;
      let assigneeName: string | null;
      if (sel.type === 'none') {
        assigneeUserId = null;
        assigneeName = null;
      } else {
        const picked = draft.offered?.members?.[sel.idx];
        assigneeUserId = picked?.id ?? seg.assigneeUserId;
        assigneeName = picked?.displayName ?? seg.assigneeName;
      }
      segs[idx] = { ...seg, assigneeUserId, assigneeName };
      const updated = await this.deps.drafts.patch(draft.id, {
        segments: segs,
        offered: clearMembers(draft.offered),
      });
      const card = await this.renderSegmentEdit(updated ?? draft, idx);
      if (messageId) await this.edit(chatId, messageId, card.text, card.replyMarkup);
    }
    await this.deps.client.answerCallbackQuery(cq.id);
  }

  // Пикер колонки для AI-сегмента: список колонок по НАЗВАНИЯМ проекта этого сегмента.
  private async renderAiStatusPicker(draft: TelegramTaskDraft, idx: number): Promise<Card> {
    const seg = draft.segments?.[idx];
    const settings = await this.kanbanSettingsOf(seg?.projectId ?? null);
    const rows = this.columnOptions(settings).map((o) => [
      { text: o.label.slice(0, 40), callback_data: `as:${draft.id}:${idx}:${o.code}` },
    ]);
    rows.push([{ text: '⬅️ Назад', callback_data: `ae:${draft.id}:${idx}` }]);
    return { text: `📊 В какую колонку задачу ${idx + 1}?`, replyMarkup: { inline_keyboard: rows } };
  }

  // Пикер колонки для ручного флоу: список колонок по названиям проекта черновика.
  private async renderManStatusPicker(draft: TelegramTaskDraft): Promise<Card> {
    const settings = await this.kanbanSettingsOf(draft.projectId);
    const rows = this.columnOptions(settings).map((o) => [
      { text: o.label.slice(0, 40), callback_data: `ts:${draft.id}:${o.code}` },
    ]);
    rows.push([{ text: '⬅️ Назад', callback_data: `ts:${draft.id}:x` }]);
    return { text: '📊 В какую колонку?', replyMarkup: { inline_keyboard: rows } };
  }

  private async onSegStatus(
    cq: TelegramCallbackQuery,
    draft: TelegramTaskDraft,
    idx: number,
    sel: AiStatusSel,
    chatId: number,
    messageId: number | undefined,
  ): Promise<void> {
    if (sel.type === 'open') {
      const card = await this.renderAiStatusPicker(draft, idx);
      if (messageId) await this.edit(chatId, messageId, card.text, card.replyMarkup);
      await this.deps.client.answerCallbackQuery(cq.id);
      return;
    }
    const segs = (draft.segments ?? []).slice();
    const seg = segs[idx];
    if (seg) {
      segs[idx] = { ...seg, targetStatus: sel.status };
      const updated = await this.deps.drafts.patch(draft.id, { segments: segs });
      const card = await this.renderSegmentEdit(updated ?? draft, idx);
      if (messageId) await this.edit(chatId, messageId, card.text, card.replyMarkup);
    }
    await this.deps.client.answerCallbackQuery(cq.id);
  }

  private async onManStatus(
    cq: TelegramCallbackQuery,
    draft: TelegramTaskDraft,
    sel: ManStatusSel,
    chatId: number,
    messageId: number | undefined,
  ): Promise<void> {
    if (sel.type === 'open') {
      const card = await this.renderManStatusPicker(draft);
      if (messageId) await this.edit(chatId, messageId, card.text, card.replyMarkup);
      await this.deps.client.answerCallbackQuery(cq.id);
      return;
    }
    // pick → сохранить колонку; back → просто вернуть карточку подтверждения.
    const updated =
      sel.type === 'pick'
        ? ((await this.deps.drafts.patch(draft.id, { targetStatus: sel.status })) ?? draft)
        : draft;
    const card = await this.renderConfirm(updated);
    if (messageId) await this.edit(chatId, messageId, card.text, card.replyMarkup);
    await this.deps.client.answerCallbackQuery(cq.id);
  }

  // Создать все включённые сегменты. Ошибка одного не валит остальные.
  private async finalizeSegments(
    draft: TelegramTaskDraft,
    userId: string,
    chatId: number,
    messageId: number | undefined,
    cqId: string,
  ): Promise<void> {
    const segs = (draft.segments ?? []).filter((s) => s.included);
    if (segs.length === 0) {
      await this.deps.client.answerCallbackQuery(cqId, {
        text: 'Нет задач для создания.',
        showAlert: true,
      });
      return;
    }
    let created = 0;
    let failed = 0;
    let lastTaskId: string | null = null;
    let lastProjectId: string | null = null;
    const summary: string[] = [];
    for (const seg of segs) {
      try {
        const title = seg.title.trim();
        const body = seg.body.trim();
        const description = title ? `**${title}**\n\n${body}` : body;
        if (description.trim().length === 0) {
          failed += 1;
          continue;
        }
        const targetId = seg.projectId ?? (await this.deps.getOrCreateInbox.execute(userId)).id;
        const delegateUserId =
          seg.assigneeUserId && seg.assigneeUserId !== userId ? seg.assigneeUserId : null;
        const task = await this.deps.createTask.execute({
          projectId: targetId,
          ownerUserId: userId,
          description,
          status: seg.targetStatus ?? DEFAULT_COLUMN,
          deadline: seg.deadline,
          delegateUserId,
        });
        created += 1;
        lastTaskId = task.id;
        lastProjectId = targetId;
        const projName = await this.projNameOf(seg.projectId);
        const delegationId = task.delegation?.id ?? null;
        if (delegateUserId && delegationId) {
          await this.notifySegmentDelegate(seg, task.id, targetId, delegationId, userId, description);
        }
        summary.push(`✅ ${escapeHtml(title || excerpt(body, 40))} → <b>${escapeHtml(projName)}</b>`);
      } catch (err) {
        console.warn('[tg-composer] finalizeSegments: segment failed:', err);
        failed += 1;
        summary.push(`⚠️ ${escapeHtml(seg.title.trim() || excerpt(seg.body, 40))} — не удалось`);
      }
    }
    await this.deps.drafts.patch(draft.id, { status: 'confirmed' });
    // reply→комментарий: маппим сообщение только когда создана РОВНО одна задача (для N задач
    // одно сообщение к нескольким задачам однозначно не привязать).
    if (created === 1 && lastTaskId && lastProjectId && messageId) {
      await this.deps.taskMessages.upsert({
        tgChatId: chatId,
        tgMessageId: messageId,
        recipientUserId: userId,
        taskId: lastTaskId,
        projectId: lastProjectId,
      });
    }
    const header = failed === 0 ? `✅ Создано задач: ${created}` : `Создано: ${created}, ошибок: ${failed}`;
    if (messageId) await this.edit(chatId, messageId, [header, '', ...summary].join('\n'));
    await this.deps.client.answerCallbackQuery(cqId, { text: created > 0 ? 'Создано' : 'Не удалось' });
  }

  // TG-уведомление делегату сегмента с кнопками Принять/Отказать (in-app/email шлёт CreateTask).
  private async notifySegmentDelegate(
    seg: TelegramDraftSegment,
    taskId: string,
    projectId: string,
    delegationId: string,
    creatorUserId: string,
    description: string,
  ): Promise<void> {
    if (!seg.assigneeUserId) return;
    const creator = await this.deps.users.getById(creatorUserId);
    const creatorName = creator?.displayName ?? 'Коллега';
    const projName = await this.projNameOf(seg.projectId);
    const msg = `👤 <b>${escapeHtml(creatorName)}</b> делегирует тебе задачу:\n📝 <i>${markdownToTelegramHtml(excerpt(description))}</i>. Проект: <b>${escapeHtml(projName)}</b>.`;
    const replyMarkup: InlineKeyboardMarkup = {
      inline_keyboard: [
        [
          { text: '✅ Принять', callback_data: `da:${delegationId}` },
          { text: '❌ Отказать', callback_data: `dd:${delegationId}` },
        ],
      ],
    };
    const res = await this.deps.sendNotification.execute({
      userId: seg.assigneeUserId,
      text: msg,
      parseMode: 'HTML',
      kind: 'task_delegation',
      taskId,
      replyMarkup,
      skipPrefsCheck: true,
      skipDedupCheck: true,
    });
    if (res.status === 'ok') {
      await this.deps.taskMessages.upsert({
        tgChatId: res.chatId,
        tgMessageId: res.messageId,
        recipientUserId: seg.assigneeUserId,
        taskId,
        projectId,
      });
    }
  }

  // Шлёт сообщение и возвращает messageId (для спиннера / последующего edit). null при ошибке.
  private async sendReturningId(chatId: number, text: string): Promise<number | null> {
    try {
      const res = await this.deps.client.sendMessage({
        chatId,
        text,
        parseMode: 'HTML',
        disableWebPagePreview: true,
      });
      return res.kind === 'ok' ? res.messageId : null;
    } catch (err) {
      console.warn('[tg-composer] sendReturningId failed:', err);
      return null;
    }
  }

  // Редактируем waitMsgId если он есть, иначе шлём новое сообщение.
  private async respond(
    chatId: number,
    waitMsgId: number | null,
    text: string,
    replyMarkup?: InlineKeyboardMarkup,
  ): Promise<void> {
    if (waitMsgId !== null) await this.edit(chatId, waitMsgId, text, replyMarkup);
    else await this.send(chatId, text, replyMarkup);
  }

  // Анимация ожидания: периодически редактирует сообщение кадрами брайля. Возвращает stop().
  // Рекурсивный setTimeout (не setInterval) — чтобы тики не накладывались, если edit подвис;
  // stop() гарантированно гасит таймер. Все edit'ы best-effort.
  private startSpinner(chatId: number, messageId: number): () => void {
    let i = 0;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();
    const tick = (): void => {
      if (stopped) return;
      i = (i + 1) % SPINNER_FRAMES.length;
      const sec = Math.round((Date.now() - startedAt) / 1000);
      // После >60с — явно говорим, что процесс идёт и ничего не зависло (большой промпт).
      const text =
        sec < 60
          ? `${SPINNER_FRAMES[i]} Перефразирую…`
          : `${SPINNER_FRAMES[i]} Большой промпт, обрабатываю… ничего не зависло (${sec}с)`;
      void this.deps.client
        .editMessageText({
          chatId,
          messageId,
          text,
          parseMode: 'HTML',
          disableWebPagePreview: true,
        })
        .catch(() => {})
        .finally(() => {
          if (!stopped) timer = setTimeout(tick, SPINNER_INTERVAL_MS);
        });
    };
    timer = setTimeout(tick, SPINNER_INTERVAL_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
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
