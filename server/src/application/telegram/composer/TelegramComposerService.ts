import type {
  TelegramClient,
  TelegramDownloadedFile,
  InlineKeyboardMarkup,
  InlineQueryResultArticle,
} from '../TelegramClient.js';
import type {
  TelegramTaskDraft,
  TelegramTaskDraftRepository,
  TelegramDraftAttachment,
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
import type { UploadTaskAttachment } from '../../task/UploadTaskAttachment.js';
import type { UpdateTask } from '../../task/UpdateTask.js';
import { taskActionKeyboard } from '../taskActionKeyboard.js';
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
  readonly sendNotification: SendAgentTelegramNotification;
  readonly client: TelegramClient;
  readonly idGen: () => string;
  readonly shortIdGen: () => string;
  readonly appUrl: string;
  // AI-перефраз сообщения в задачи (простой/быстрый compose pass-1). Best-effort: если
  // диспетчер офлайн / job упал / таймаут — конструктор откатывается на ручной флоу.
  readonly enqueueAiPromptJob: EnqueueAiPromptJob;
  readonly waitForAiPromptJob: WaitForAiPromptJob;
  readonly uploadAttachment?: UploadTaskAttachment;
  readonly updateTask?: UpdateTask;
};

// composing-черновик по запросу владельца практически не истекает (~10 лет) — можно вернуться
// к карточке «Новая задача» когда угодно.
const DRAFT_TTL_SECONDS = 3650 * 24 * 60 * 60;
const AUTO_CREATE_SECONDS = 10 * 60;
const AUTO_RETRY_SECONDS = 60;
const STALE_CONFIRMATION_SECONDS = 15 * 60;
const PAGE_SIZE = 6; // кнопок-вариантов на страницу пикера
const ATTACHMENT_TASK_PAGE_SIZE = 6;
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
// tp:<d>:<idx|i|?|pN>  td:<d>:<idx|n|pN>  tc:<d>  tx:<d>. Легаси da:/dd: (принять/
// отказать) удалены — parseCallback вернёт null, старые кнопки гаснут молча.
type ProjectSel =
  | { readonly type: 'idx'; readonly idx: number }
  | { readonly type: 'inbox' }
  | { readonly type: 'choose' }
  | { readonly type: 'page'; readonly page: number };
type AssigneeSel =
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
type AiAssigneeSel =
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
  | { readonly kind: 'assignee'; readonly draftId: string; readonly sel: AssigneeSel }
  | { readonly kind: 'confirm'; readonly draftId: string }
  | { readonly kind: 'cancel'; readonly draftId: string }
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
  | { readonly kind: 'seg-assignee'; readonly draftId: string; readonly seg: number; readonly sel: AiAssigneeSel }
  | { readonly kind: 'seg-status'; readonly draftId: string; readonly seg: number; readonly sel: AiStatusSel }
  | { readonly kind: 'man-status'; readonly draftId: string; readonly sel: ManStatusSel }
  | { readonly kind: 'file-open'; readonly draftId: string; readonly file: number; readonly page: number }
  | {
      readonly kind: 'file-toggle';
      readonly draftId: string;
      readonly file: number;
      readonly seg: number;
      readonly page: number;
    }
  | {
      readonly kind: 'file-group';
      readonly draftId: string;
      readonly file: number;
      readonly selectAll: boolean;
      readonly page: number;
    }
  | { readonly kind: 'file-done'; readonly draftId: string }
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
      return { kind: 'assignee', draftId, sel: parseAssigneeSel(sel) };
    }
    case 'tc':
      return { kind: 'confirm', draftId: rest };
    case 'tx':
      return { kind: 'cancel', draftId: rest };
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
      return { kind: 'seg-assignee', draftId, seg: toIdx(segStr), sel: parseAiAssigneeSel(sel) };
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
    case 'fs': {
      const [draftId, fileStr, pageStr] = rest.split(':');
      if (!draftId || fileStr === undefined) return null;
      return {
        kind: 'file-open',
        draftId,
        file: toIdx(fileStr),
        page: parsePage(pageStr),
      };
    }
    case 'fx': {
      const [draftId, fileStr, segStr, pageStr] = rest.split(':');
      if (!draftId || fileStr === undefined || segStr === undefined) return null;
      return {
        kind: 'file-toggle',
        draftId,
        file: toIdx(fileStr),
        seg: toIdx(segStr),
        page: parsePage(pageStr),
      };
    }
    case 'fg': {
      const [draftId, fileStr, mode, pageStr] = rest.split(':');
      if (!draftId || fileStr === undefined || (mode !== 'a' && mode !== 'n')) return null;
      return {
        kind: 'file-group',
        draftId,
        file: toIdx(fileStr),
        selectAll: mode === 'a',
        page: parsePage(pageStr),
      };
    }
    case 'fd':
      return rest ? { kind: 'file-done', draftId: rest } : null;
    default:
      return null;
  }
}

function parsePage(value: string | undefined): number {
  if (!value) return 0;
  const normalized = value.startsWith('p') ? value.slice(1) : value;
  return Math.max(0, Number(normalized) || 0);
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

function parseAiAssigneeSel(sel: string): AiAssigneeSel {
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

function parseAssigneeSel(sel: string): AssigneeSel {
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
type AttachmentResult = { readonly attached: number; readonly failed: number };
type AttachmentDownloadCache = Map<string, Promise<TelegramDownloadedFile | null>>;

export type TelegramMessageIngestOptions = {
  readonly sourceKey?: string | null;
  // The Telegram transport only waits until the draft is durable. AI enrichment continues in
  // the background, so polling/webhook acknowledgements never depend on a long-running job.
  readonly background?: boolean;
};

function withDefaultAttachmentTargets(
  attachments: readonly TelegramDraftAttachment[],
): TelegramDraftAttachment[] {
  return attachments.map((attachment) => {
    const targets = attachment.targetSegmentIndexes ?? [];
    return {
      ...attachment,
      targetSegmentIndexes: targets.length > 0 ? [...new Set(targets)] : [0],
    };
  });
}

function appendNewAttachments(
  current: readonly TelegramDraftAttachment[],
  incoming: readonly TelegramDraftAttachment[],
): { readonly attachments: TelegramDraftAttachment[]; readonly added: number } {
  const attachments: TelegramDraftAttachment[] = current.map((attachment) => ({
    ...attachment,
    targetSegmentIndexes: [...attachment.targetSegmentIndexes],
  }));
  const keys = new Set(attachments.map((attachment) => attachment.key));
  let added = 0;
  for (const attachment of withDefaultAttachmentTargets(incoming)) {
    if (keys.has(attachment.key)) continue;
    keys.add(attachment.key);
    attachments.push(attachment);
    added += 1;
  }
  return { attachments, added };
}

// Конструктор задач: парсит `+проект текст @ответственный`, ведёт многошаговый выбор кнопками,
// создаёт задачу с одним ответственным и при назначении коллеге шлёт ему карточку с
// кнопками «Завершить»/«Комментировать»/«Открыть».
export class TelegramComposerService {
  private readonly activeSpinners = new Map<string, () => Promise<void>>();
  private readonly callbackLocks = new Map<string, Promise<void>>();

  constructor(private readonly deps: Deps) {}

  // Фоновый тик. Дедлайн и claim живут в БД, поэтому рестарт/несколько инстансов безопасны:
  // конкретный черновик из composing в confirming переведёт только один процесс.
  async processDueAutoCreate(limit = 25): Promise<number> {
    await this.deps.drafts.recoverStaleConfirmations(
      STALE_CONFIRMATION_SECONDS,
      AUTO_RETRY_SECONDS,
    );
    const due = await this.deps.drafts.listDueForAutoCreate(limit);
    let processed = 0;
    for (const candidate of due) {
      const draft = await this.deps.drafts.claimForConfirmation(candidate.id, true);
      if (!draft) continue;
      await this.stopActiveSpinner(draft.id);
      processed += 1;
      try {
        const messageId = draft.tgMessageId ?? undefined;
        if (draft.segments) {
          await this.finalizeSegments(
            draft,
            draft.creatorUserId,
            draft.tgChatId,
            messageId,
            null,
            { alreadyClaimed: true, automatic: true },
          );
        } else {
          await this.finalize(
            draft,
            draft.creatorUserId,
            draft.tgChatId,
            messageId,
            null,
            { alreadyClaimed: true, automatic: true },
          );
        }
      } catch (err) {
        console.warn(`[tg-composer] auto-create draft ${draft.id} failed:`, err);
        await this.deps.drafts.releaseConfirmation(draft.id, AUTO_RETRY_SECONDS);
      }
    }
    return processed;
  }

  // Точка входа из HandleTelegramWebhook: не-командное, не-reply сообщение → задача.
  // Любое сообщение прогоняется через простой/быстрый AI-compose (перефраз + авто проект/
  // ответственный/дедлайн); пока AI думает — «Ожидайте, перефразирую…» со спиннером. Если AI
  // недоступен (диспетчер офлайн / job упал / таймаут / битый JSON) — тихий откат на ручной
  // флоу. Все AI-вызовы best-effort: любая ошибка только логируется, бот остаётся рабочим.
  async startFromMessage(
    tgUserId: number,
    chatId: number,
    rawText: string,
    groupCtx?: TelegramGroupContext,
    attachments: readonly TelegramDraftAttachment[] = [],
    options: TelegramMessageIngestOptions = {},
  ): Promise<void> {
    // Групповое сообщение: каждый привязанный участник работает «как отправитель» (в своё) —
    // продолжаем обычным флоу ниже. Непривязанный → в «Входящие» владельца (или просьба привязать).
    if (groupCtx) {
      const route = await this.resolveGroupRouting(tgUserId, groupCtx.ownerUserId);
      if (route === 'owner-inbox') {
        // ownerUserId гарантированно задан, когда route === 'owner-inbox'.
        return this.createInOwnerInbox(
          groupCtx.ownerUserId as string,
          chatId,
          rawText,
          groupCtx,
          attachments,
          options.sourceKey ?? null,
        );
      }
      if (route === 'nudge') return this.send(chatId, this.bindHintText());
      // route === 'self' → обычный флоу ниже (отправитель точно привязан).
    }

    const userId = await this.deps.users.findUserIdByTelegramUserId(tgUserId);
    if (!userId) {
      await this.send(chatId, this.notLinkedText());
      return;
    }

    if (options.sourceKey) {
      const existing = await this.deps.drafts.findBySourceKey(options.sourceKey);
      if (existing) {
        // A media group can straddle two getUpdates batches (or Telegram's batch limit). The
        // source key still identifies one task, but later album parts must be merged rather than
        // discarded as duplicate delivery. Replayed parts are deduplicated by stable file key.
        const merged = appendNewAttachments(existing.attachments, attachments);
        if (merged.added > 0 && existing.status === 'composing') {
          await this.deps.drafts.patchComposing(existing.id, { attachments: merged.attachments });
        }
        return;
      }
    }

    const parsed = parseComposerMessage(rawText);
    // Нет текста задачи (например, один '+Проект') → ручной флоу покажет подсказку (без AI).
    if (parsed.taskText.trim().length === 0) {
      await this.manualFlow(
        userId,
        chatId,
        rawText,
        undefined,
        attachments,
        undefined,
        options.sourceKey ?? null,
      );
      return;
    }

    let hint: { projectId: string | null; taskText: string };
    try {
      hint = await this.resolveProjectHint(userId, parsed);
    } catch (err) {
      console.warn('[tg-composer] project hint failed → manual flow:', err);
      await this.manualFlow(
        userId,
        chatId,
        rawText,
        undefined,
        attachments,
        undefined,
        options.sourceKey ?? null,
      );
      return;
    }
    const aiText = this.buildAiText(hint.taskText, parsed.assigneeQuery);
    let fallbackAssigneeUserId: string | null = null;
    try {
      fallbackAssigneeUserId = await this.resolveUniqueAssignee(
        userId,
        hint.projectId,
        parsed.assigneeQuery,
      );
    } catch (err) {
      // The durable raw fallback still works with the creator as assignee. AI/manual enrichment
      // will retry the richer resolution without making intake depend on this optional lookup.
      console.warn('[tg-composer] fallback assignee hint failed:', err);
    }
    const draftId = this.deps.shortIdGen();
    const draft = await this.deps.drafts.create({
      id: draftId,
      sourceKey: options.sourceKey ?? null,
      creatorUserId: userId,
      tgChatId: chatId,
      // Auto-create can win while a long AI job is still running. Keep the human task text in
      // the raw fallback (without the model-only "Ответственный:" instruction) and persist the
      // uniquely resolved explicit @assignee separately.
      taskText: hint.taskText,
      projectId: hint.projectId,
      assigneeUserId: fallbackAssigneeUserId,
      attachments: withDefaultAttachmentTargets(attachments),
      ttlSeconds: DRAFT_TTL_SECONDS,
      autoCreateSeconds: AUTO_CREATE_SECONDS,
    });
    // A concurrent retry with the same sourceKey returns the already persisted draft. Only the
    // creator of that row starts AI/card work; the retry is now safely acknowledged as duplicate.
    if (draft.id !== draftId) return;

    const enrichment = this.enrichDraft(draft, userId, chatId, rawText, parsed, hint, aiText);
    if (options.background) {
      void enrichment.catch((err) => console.warn('[tg-composer] background enrichment failed:', err));
      return;
    }
    await enrichment;
  }

  private async enrichDraft(
    draft: TelegramTaskDraft,
    userId: string,
    chatId: number,
    rawText: string,
    parsed: ReturnType<typeof parseComposerMessage>,
    hint: { projectId: string | null; taskText: string },
    aiText: string,
  ): Promise<void> {
    let waitMsgId: number | null = null;
    let stopSpinner: (() => Promise<void>) | null = null;
    try {
      waitMsgId = await this.sendReturningId(chatId, WAIT_TEXT);
      if (waitMsgId !== null) await this.deps.drafts.patch(draft.id, { tgMessageId: waitMsgId });
      const job = await this.deps.enqueueAiPromptJob.execute({
        userId,
        text: aiText,
        projectId: hint.projectId,
        mode: 'compose',
      });
      const beforeWait = await this.deps.drafts.getById(draft.id);
      if (!beforeWait || beforeWait.status !== 'composing') return;
      if (waitMsgId !== null) {
        stopSpinner = this.startSpinner(chatId, waitMsgId, draft.id);
        this.activeSpinners.set(draft.id, stopSpinner);
      }
      const parsedSegs = await this.pollCompose(userId, job.id);
      if (stopSpinner) {
        await stopSpinner();
        if (this.activeSpinners.get(draft.id) === stopSpinner) {
          this.activeSpinners.delete(draft.id);
        }
        stopSpinner = null;
      }
      const segments = this.toDraftSegments(parsedSegs, hint.projectId);
      const updated = await this.deps.drafts.patchComposing(draft.id, {
        taskText: aiText,
        segments,
      });
      if (!updated) return;
      const card = await this.renderSegmentsCard(updated);
      const tgMessageId = await this.respond(chatId, waitMsgId, card.text, card.replyMarkup);
      if (tgMessageId !== null) await this.deps.drafts.patch(updated.id, { tgMessageId });
    } catch (err) {
      if (stopSpinner) await stopSpinner();
      console.warn('[tg-composer] AI compose failed → ручной флоу:', err);
      const current = await this.deps.drafts.getById(draft.id);
      if (!current || current.status !== 'composing') return;
      await this.manualFlow(
        userId,
        chatId,
        rawText,
        waitMsgId ?? undefined,
        current.attachments,
        current,
      );
    } finally {
      if (stopSpinner) await stopSpinner();
      if (!stopSpinner || this.activeSpinners.get(draft.id) === stopSpinner) {
        this.activeSpinners.delete(draft.id);
      }
    }
  }

  // Развилка для группового сообщения. Каждый привязанный участник работает «как отправитель»
  // (в свои проекты/«Входящие», со своим ответственным) — как в личке. Возвращает:
  //   'self'        — обычный флоу от лица отправителя (он привязан);
  //   'owner-inbox' — отправитель НЕ привязан, но группа привязана к владельцу → в его «Входящие»
  //                   (чтобы запрос не потерялся) + предложение привязать аккаунт;
  //   'nudge'       — отправитель не привязан и владельца нет → попросить привязать.
  private async resolveGroupRouting(
    tgUserId: number,
    ownerUserId: string | null,
  ): Promise<'self' | 'owner-inbox' | 'nudge'> {
    const senderUserId = await this.deps.users.findUserIdByTelegramUserId(tgUserId);
    if (senderUserId) return 'self'; // привязан → всегда в своё
    return ownerUserId ? 'owner-inbox' : 'nudge'; // непривязанный → к владельцу (или просьба привязать)
  }

  // Фолбэк для НЕпривязанного участника: кладём задачу в «Входящие» владельца группы (от его
  // лица) с атрибуцией автора — чтобы запрос не потерялся. Плюс кнопка «Привязать аккаунт»:
  // привязавшись, участник в следующий раз получит задачу в СВОИ проекты. Без карточки/кнопок
  // создания — их в группе жал бы не владелец-создатель.
  private async createInOwnerInbox(
    ownerUserId: string,
    chatId: number,
    rawText: string,
    groupCtx: TelegramGroupContext,
    attachments: readonly TelegramDraftAttachment[],
    sourceKey: string | null = null,
  ): Promise<void> {
    const body = rawText.trim();
    if (body.length === 0) return;
    let receipt: TelegramTaskDraft | null = null;
    try {
      const inbox = await this.deps.getOrCreateInbox.execute(ownerUserId);
      if (sourceKey) {
        receipt = await this.deps.drafts.findBySourceKey(sourceKey);
        if (receipt) {
          const merged = appendNewAttachments(receipt.attachments, attachments);
          if (merged.added > 0 && receipt.status === 'composing') {
            receipt =
              (await this.deps.drafts.patchComposing(receipt.id, {
                attachments: merged.attachments,
              })) ?? receipt;
          }
          if (
            receipt.status === 'confirmed' ||
            receipt.status === 'cancelled' ||
            receipt.status === 'expired'
          ) {
            return;
          }
        } else {
          receipt = await this.deps.drafts.create({
            id: this.deps.shortIdGen(),
            sourceKey,
            creatorUserId: ownerUserId,
            tgChatId: chatId,
            taskText: this.buildOwnerInboxDescription(body, groupCtx),
            projectId: inbox.id,
            attachments: withDefaultAttachmentTargets(attachments),
            ttlSeconds: DRAFT_TTL_SECONDS,
            autoCreateSeconds: null,
          });
        }
        receipt = await this.deps.drafts.claimForConfirmation(receipt.id, false);
        if (!receipt) return;
      }
      const task = await this.deps.createTask.execute({
        projectId: inbox.id,
        ownerUserId,
        description: this.buildOwnerInboxDescription(body, groupCtx),
        status: DEFAULT_COLUMN,
      });
      // Close the idempotency receipt immediately after task creation. Everything below is
      // best-effort decoration; a Telegram retry must never create a duplicate task.
      if (receipt) await this.deps.drafts.patch(receipt.id, { status: 'confirmed' });
      const attachmentResult = await this.attachDraftAttachments(
        receipt?.attachments ?? attachments,
        task.id,
        inbox.id,
        ownerUserId,
        this.buildOwnerInboxDescription(body, groupCtx),
      );
      const profileUrl = `${this.deps.appUrl.replace(/\/$/, '')}/profile`;
      await this.send(
        chatId,
        `📥 Добавил в «Входящие»: <i>${escapeHtml(excerpt(body))}</i>\n<i>Поставил: ${escapeHtml(groupCtx.senderName)}</i>\n\n` +
          `🔗 Привяжи аккаунт — и задачи будут падать в твои проекты, а не сюда.${this.attachmentResultText(attachmentResult)}`,
        { inline_keyboard: [[{ text: '🔗 Привязать аккаунт', url: profileUrl }]] },
      );
    } catch (err) {
      console.warn('[tg-composer] owner-inbox create failed:', err);
      if (receipt?.status === 'confirming') {
        await this.deps.drafts.releaseConfirmation(receipt.id, AUTO_RETRY_SECONDS).catch(() => {});
      }
      await this.send(chatId, '❌ Не удалось создать задачу. Попробуйте позже.');
      // Retry transient persistence failures. sourceKey + atomic claim keep retries safe; a
      // swallowed exception would acknowledge Telegram and permanently lose the task.
      throw err;
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

  // Ручной флоу (без AI): парсит `+проект текст @ответственный`, ведёт многошаговый выбор кнопками.
  // waitMsgId — если задан (осталось сообщение «Ожидайте…» от AI-попытки), первую карточку
  // рендерим редактированием этого сообщения, иначе шлём новое.
  private async manualFlow(
    userId: string,
    chatId: number,
    rawText: string,
    waitMsgId?: number,
    attachments: readonly TelegramDraftAttachment[] = [],
    existingDraft?: TelegramTaskDraft,
    sourceKey: string | null = null,
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

    // Резолв ответственного.
    let assigneeUserId: string | null = null;
    let offeredMembers: TelegramDraftOffered['members'] | undefined;
    if (parsed.assigneeQuery !== null) {
      const candidates = projectId
        ? (await this.deps.members.listByProject(projectId)).map((m) => ({
            id: m.userId,
            displayName: m.user.displayName,
          }))
        : await this.deps.members.listSharedUsers(userId);
      const r = fuzzyMatch(parsed.assigneeQuery, candidates, (u) => u.displayName);
      if (r.unique) {
        assigneeUserId = r.unique.id;
      } else {
        const list = r.matches.length > 0 ? r.matches : candidates;
        offeredMembers = list.map((u) => ({ id: u.id, displayName: u.displayName }));
      }
    }

    const offered: TelegramDraftOffered | null =
      offeredProjects || offeredMembers
        ? { ...(offeredProjects ? { projects: offeredProjects } : {}), ...(offeredMembers ? { members: offeredMembers } : {}) }
        : null;

    const draftId = existingDraft?.id ?? this.deps.shortIdGen();
    const draft = existingDraft
      ? ((await this.deps.drafts.patch(draftId, {
          taskText,
          projectId,
          assigneeUserId,
          offered,
          // AI may have persisted segments before a later render/transport error. This fallback
          // renders a manual tc:-card, so its stored finalize path must be manual as well.
          segments: null,
          attachments: withDefaultAttachmentTargets(attachments),
        })) ?? existingDraft)
      : await this.deps.drafts.create({
          id: draftId,
          sourceKey,
          creatorUserId: userId,
          tgChatId: chatId,
          taskText,
          projectId,
          assigneeUserId,
          offered,
          attachments: withDefaultAttachmentTargets(attachments),
          ttlSeconds: DRAFT_TTL_SECONDS,
          autoCreateSeconds: AUTO_CREATE_SECONDS,
        });
    // A concurrent retry may have won the unique source_key insert. Its worker owns rendering;
    // this delivery is already durable and can be acknowledged without sending a duplicate card.
    if (!existingDraft && draft.id !== draftId) return;

    const card = await this.nextCard(draft);
    const tgMessageId = await this.respond(chatId, waitMsgId ?? null, card.text, card.replyMarkup);
    if (tgMessageId !== null) await this.deps.drafts.patch(draft.id, { tgMessageId });
  }

  // Phase D — inline-режим: `@ProjectsFlow_Bot текст задачи [@ответственный]` показывает живой
  // список проектов. Выбор отправляет канонический `+<Проект> текст @ответственный` в чат, который
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
    const assigneeSuffix = parsed.assigneeQuery ? ` @${parsed.assigneeQuery}` : '';
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
      input_message_content: { message_text: `${taskText}${assigneeSuffix}` },
    });

    // По проекту на вариант (cap 8 — лимит inline-результатов держим скромным).
    const projects = (await this.deps.members.listProjectsForUser(userId)).filter((p) => !p.isInbox);
    for (const p of projects.slice(0, 8)) {
      results.push({
        type: 'article',
        id: `p:${p.id}`,
        title: `📁 ${p.name}`,
        description: taskText,
        input_message_content: { message_text: `+${p.name} ${taskText}${assigneeSuffix}` },
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

    return this.withCallbackLock(cb.draftId, async () => {
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
        const cancelled = await this.deps.drafts.cancelComposing(draft.id);
        if (cancelled && messageId) await this.edit(chatId, messageId, '✖️ Отменено.');
        await this.deps.client.answerCallbackQuery(cq.id, {
          text: cancelled ? 'Отменено' : 'Этот черновик уже обрабатывается.',
        });
        return;
      }
      case 'project':
        return this.onProjectSel(cq, draft, userId, cb.sel, chatId, messageId);
      case 'assignee':
        return this.onAssigneeSel(cq, draft, cb.sel, chatId, messageId);
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
      case 'seg-assignee':
        return this.onSegAssignee(cq, draft, userId, cb.seg, cb.sel, chatId, messageId);
      case 'seg-status':
        return this.onSegStatus(cq, draft, cb.seg, cb.sel, chatId, messageId);
      case 'man-status':
        return this.onManStatus(cq, draft, cb.sel, chatId, messageId);
      case 'file-open':
        return this.onFileOpen(cq, draft, cb.file, cb.page, chatId, messageId);
      case 'file-toggle':
        return this.onFileToggle(cq, draft, cb.file, cb.seg, cb.page, chatId, messageId);
      case 'file-group':
        return this.onFileGroup(
          cq,
          draft,
          cb.file,
          cb.selectAll,
          cb.page,
          chatId,
          messageId,
        );
      case 'file-done':
        return this.onFileDone(cq, draft, chatId, messageId);
    }
    });
  }

  private async withCallbackLock<T>(draftId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.callbackLocks.get(draftId) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(action);
    const tracked = run.then(
      () => undefined,
      () => undefined,
    );
    this.callbackLocks.set(draftId, tracked);
    try {
      return await run;
    } finally {
      if (this.callbackLocks.get(draftId) === tracked) this.callbackLocks.delete(draftId);
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

  private async onAssigneeSel(
    cq: TelegramCallbackQuery,
    draft: TelegramTaskDraft,
    sel: AssigneeSel,
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
    const assigneeUserId =
      sel.type === 'none' ? null : (draft.offered?.members?.[sel.idx]?.id ?? null);
    const updated = await this.deps.drafts.patch(draft.id, {
      assigneeUserId,
      offered: clearMembers(draft.offered),
    });
    await this.advance(cq, updated ?? draft, chatId, messageId);
  }

  // После выбора проекта/ответственного — показать следующий шаг (пикер или подтверждение).
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
    cqId: string | null,
    opts: { readonly alreadyClaimed?: boolean; readonly automatic?: boolean } = {},
  ): Promise<void> {
    const claimed = opts.alreadyClaimed
      ? draft
      : await this.deps.drafts.claimForConfirmation(draft.id, false);
    if (!claimed) {
      if (cqId) {
        await this.deps.client.answerCallbackQuery(cqId, { text: 'Этот черновик уже обработан.' });
      }
      return;
    }
    draft = claimed;
    messageId ??= draft.tgMessageId ?? undefined;
    const text = (draft.taskText ?? '').trim();
    if (text.length === 0) {
      await this.deps.drafts.patch(draft.id, { status: 'cancelled' });
      if (cqId) {
        await this.deps.client.answerCallbackQuery(cqId, {
          text: 'Пустой текст задачи.',
          showAlert: true,
        });
      }
      return;
    }

    try {
      // Same rule as finalizeSegments: no project + a delegate → the assignee's inbox.
      const delegateUserId =
        draft.assigneeUserId && draft.assigneeUserId !== userId ? draft.assigneeUserId : null;
      const inboxOwnerId = delegateUserId ?? userId;
      const delegatedInbox = !draft.projectId && inboxOwnerId !== userId;
      const targetId =
        draft.projectId ?? (await this.deps.getOrCreateInbox.execute(inboxOwnerId)).id;
      const task = await this.deps.createTask.execute({
        projectId: targetId,
        ownerUserId: userId,
        description: text,
        status: draft.targetStatus ?? DEFAULT_COLUMN,
        assigneeUserId: draft.assigneeUserId ?? userId,
        allowInboxDelegation: delegatedInbox,
      });
      // Сразу закрываем claim после успешного createTask. Всё ниже — best-effort оформление;
      // его сбой не должен вернуть уже созданную задачу в очередь и породить дубль.
      await this.deps.drafts.patch(draft.id, { status: 'confirmed' });
      const attachmentResult = await this.attachDraftAttachments(
        draft.attachments,
        task.id,
        targetId,
        userId,
        text,
      );
      if (messageId) {
        await this.deps.taskMessages.upsert({
          tgChatId: chatId,
          tgMessageId: messageId,
          recipientUserId: userId,
          taskId: task.id,
          projectId: targetId,
        });
      }
      if (draft.assigneeUserId && draft.assigneeUserId !== userId) {
        await this.notifyAssignee(draft, task.id, targetId, userId, text);
      }

      const projName = await this.projNameOf(draft.projectId);
      const assigneeSuffix = draft.assigneeUserId
        ? ` Ответственный — <b>${escapeHtml((await this.deps.users.getById(draft.assigneeUserId))?.displayName ?? 'участник')}</b>.`
        : '';
      const automatic = opts.automatic ? '\n\n⏱ Создано автоматически через 10 минут.' : '';
      const attachmentSuffix = this.attachmentResultText(attachmentResult);
      if (messageId) {
        await this.edit(
          chatId,
          messageId,
          `✅ Задача создана в <b>${escapeHtml(projName)}</b>.${assigneeSuffix}\n📝 ${markdownToTelegramHtml(excerpt(text))}${attachmentSuffix}${automatic}\n\n↩️ Ответь на это сообщение, чтобы добавить комментарий.`,
        );
      }
      if (cqId) {
        await this.deps.client.answerCallbackQuery(cqId, {
          text: draft.assigneeUserId ? 'Создано и назначено' : 'Создано',
        });
      }
    } catch (err) {
      console.warn('[tg-composer] finalize failed:', err);
      await this.deps.drafts.releaseConfirmation(draft.id, AUTO_RETRY_SECONDS);
      if (cqId) {
        await this.deps.client.answerCallbackQuery(cqId, {
          text: 'Не удалось создать задачу. Повторю автоматически через минуту.',
          showAlert: true,
        });
      }
    }
  }

  // TG-карточка новому ответственному: кнопки действий по задаче. Reply на карточку =
  // комментарий (существующий механизм telegram_task_messages).
  private async notifyAssignee(
    draft: TelegramTaskDraft,
    taskId: string,
    projectId: string,
    creatorUserId: string,
    text: string,
  ): Promise<void> {
    if (!draft.assigneeUserId) return;
    const creator = await this.deps.users.getById(creatorUserId);
    const creatorName = creator?.displayName ?? 'Коллега';
    const projName = draft.projectId
      ? ((await this.deps.projects.getById(draft.projectId))?.name ?? null)
      : null;
    const ctx = projName ? ` Проект: <b>${escapeHtml(projName)}</b>.` : ' (во «Входящие»).';
    const msg = `👤 <b>${escapeHtml(creatorName)}</b> назначил(а) тебя ответственным:\n📝 <i>${mdToPlain(excerpt(text))}</i>.${ctx}`;
    const res = await this.deps.sendNotification.execute({
      userId: draft.assigneeUserId,
      text: msg,
      parseMode: 'HTML',
      kind: 'task_assignee_changed',
      taskId,
      replyMarkup: {
        inline_keyboard: [
          ...taskActionKeyboard(taskId).inline_keyboard,
          [{ text: 'Открыть в ProjectsFlow', url: `${this.deps.appUrl.replace(/\/$/, '')}/projects/${projectId}?task=${taskId}` }],
        ],
      },
      skipPrefsCheck: true, // важное — должно дойти независимо от prefs
      skipDedupCheck: true,
    });
    if (res.status === 'ok') {
      await this.deps.taskMessages.upsert({
        tgChatId: res.chatId,
        tgMessageId: res.messageId,
        recipientUserId: draft.assigneeUserId,
        taskId,
        projectId,
      });
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
      text: `🆕 <b>Новая задача</b>\n📝 ${markdownToTelegramHtml(excerpt(draft.taskText ?? ''))}\n\n📁 В какой проект?${hint}\n\n⏱ Без ответа создам автоматически через 10 минут.`,
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
      { text: '👤 Оставить за мной', callback_data: `td:${draft.id}:n` },
      { text: '✖️ Отмена', callback_data: `tx:${draft.id}` },
    ]);
    return {
      text: `🆕 <b>Новая задача</b>\n📝 ${markdownToTelegramHtml(excerpt(draft.taskText ?? ''))}\n\n👤 Кто ответственный?\n\n⏱ Без ответа создам автоматически через 10 минут.`,
      replyMarkup: { inline_keyboard: rows },
    };
  }

  private async renderConfirm(draft: TelegramTaskDraft): Promise<Card> {
    const projName = draft.projectId
      ? ((await this.deps.projects.getById(draft.projectId))?.name ?? 'проект')
      : 'Входящие';
    const assigneeName = draft.assigneeUserId
      ? ((await this.deps.users.getById(draft.assigneeUserId))?.displayName ?? null)
      : null;
    const columnName = await this.columnLabelFor(draft.projectId, draft.targetStatus);
    const lines = [
      '🆕 <b>Новая задача</b>',
      `📁 Проект: <b>${escapeHtml(projName)}</b>`,
      `📊 Колонка: <b>${escapeHtml(columnName)}</b>`,
    ];
    lines.push(`👤 Ответственный: <b>${escapeHtml(assigneeName ?? 'Вы')}</b>`);
    lines.push(`📝 ${markdownToTelegramHtml(excerpt(draft.taskText ?? ''))}`);
    if (draft.attachments.length > 0) {
      lines.push(`📎 Вложения: <b>${draft.attachments.length}</b>`);
    }
    lines.push('', '⏱ Без нажатия создам автоматически через 10 минут.');
    const createLabel = '✅ Создать';
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

  // Текст для AI: задача + (если в `@ответственный` назван человек) явная подсказка модели.
  private buildAiText(taskText: string, assigneeQuery: string | null): string {
    const t = taskText.trim();
    if (assigneeQuery && assigneeQuery.trim().length > 0) {
      return `${t}\n\nОтветственный: ${assigneeQuery.trim()}`;
    }
    return t;
  }

  private async resolveUniqueAssignee(
    userId: string,
    projectId: string | null,
    assigneeQuery: string | null,
  ): Promise<string | null> {
    if (!assigneeQuery?.trim()) return null;
    const candidates = projectId
      ? (await this.deps.members.listByProject(projectId)).map((member) => ({
          id: member.userId,
          displayName: member.user.displayName,
        }))
      : await this.deps.members.listSharedUsers(userId);
    return fuzzyMatch(assigneeQuery, candidates, (candidate) => candidate.displayName).unique?.id ?? null;
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
  // пинит все сегменты в этот проект (ответственного оставляем — провалидируется при создании).
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

  // Имя ответственного для показа: по userId (если сматчился), сырое имя-подсказка
  // из текста либо создатель как обязательный fallback.
  private async assigneeLabelOf(
    seg: TelegramDraftSegment,
    fallbackUserId: string,
  ): Promise<string> {
    if (seg.assigneeUserId) {
      return (
        (await this.deps.users.getById(seg.assigneeUserId))?.displayName ??
        seg.assigneeName ??
        'Ответственный'
      );
    }
    if (seg.assigneeName) return seg.assigneeName;
    return (await this.deps.users.getById(fallbackUserId))?.displayName ?? 'Вы';
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
    const assignee = await this.assigneeLabelOf(seg, draft.creatorUserId);
    const columnName = await this.columnLabelFor(seg.projectId, seg.targetStatus);
    const lines = ['🆕 <b>Новая задача</b>', `📁 Проект: <b>${escapeHtml(projName)}</b>`];
    lines.push(`👤 Ответственный: <b>${escapeHtml(assignee)}</b>`);
    lines.push(`📊 Колонка: <b>${escapeHtml(columnName)}</b>`);
    if (seg.deadline) lines.push(`📅 Срок: <b>${escapeHtml(seg.deadline)}</b>`);
    if (seg.title.trim()) lines.push(`📝 <b>${mdToPlain(seg.title.trim())}</b>`);
    lines.push(markdownToTelegramHtml(excerpt(seg.body)));
    if (draft.attachments.length > 0) {
      lines.push(`📎 Вложения: <b>${draft.attachments.length}</b>`);
    }
    lines.push('', '⏱ Без нажатия создам автоматически через 10 минут.');
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
      const assignee = await this.assigneeLabelOf(seg, draft.creatorUserId);
      const colStatus = seg.targetStatus ?? DEFAULT_COLUMN;
      const columnName = resolveColumnLabel((await settingsFor(seg.projectId))?.[colStatus], colStatus);
      const meta = [`📁 ${escapeHtml(projName)}`, `📊 ${escapeHtml(columnName)}`];
      meta.push(`👤 ${escapeHtml(assignee)}`);
      meta.push(`📅 ${seg.deadline ? escapeHtml(seg.deadline) : '—'}`);
      const titleText = seg.title.trim() || excerpt(seg.body, 60);
      const strike = seg.included ? '' : ' <i>(исключена)</i>';
      lines.push(`${i + 1}. ${seg.included ? '' : '🚫 '}<b>${mdToPlain(titleText)}</b>${strike}`);
      lines.push(`   ${meta.join(' · ')}`);
    }
    if (draft.attachments.length > 0) {
      lines.push('', ...this.attachmentAssignmentSummary(draft));
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
    if (draft.attachments.length > 0 && segs.length > 1) {
      rows.push([
        {
          text: `📎 Распределить файлы (${draft.attachments.length})`,
          callback_data: `fs:${draft.id}:0:p0`,
        },
      ]);
    }
    lines.push('', '⏱ Без нажатия создам автоматически через 10 минут.');
    return { text: lines.join('\n'), replyMarkup: { inline_keyboard: rows } };
  }

  private attachmentAssignmentSummary(draft: TelegramTaskDraft): string[] {
    const lines = [`📎 <b>Вложения: ${draft.attachments.length}</b>`];
    const visible = draft.attachments.slice(0, 8);
    for (let index = 0; index < visible.length; index++) {
      const attachment = visible[index];
      if (!attachment) continue;
      const targets = [...new Set(attachment.targetSegmentIndexes)]
        .filter((seg) => seg >= 0 && seg < (draft.segments?.length ?? 0))
        .sort((a, b) => a - b)
        .map((seg) => seg + 1);
      lines.push(
        `${index + 1}. ${escapeHtml(excerpt(attachment.filename, 42))} → ${
          targets.length > 0 ? `задачи ${targets.join(', ')}` : '<i>не прикреплять</i>'
        }`,
      );
    }
    if (draft.attachments.length > visible.length) {
      lines.push(`… и ещё ${draft.attachments.length - visible.length}`);
    }
    return lines;
  }

  private async renderAttachmentPicker(
    draft: TelegramTaskDraft,
    requestedFile: number,
    requestedPage: number,
  ): Promise<Card> {
    const attachments = draft.attachments;
    const segments = draft.segments ?? [];
    if (attachments.length === 0 || segments.length <= 1) return this.renderSegmentsCard(draft);

    const file = Math.max(0, Math.min(requestedFile, attachments.length - 1));
    const attachment = attachments[file]!;
    const pages = Math.max(1, Math.ceil(segments.length / ATTACHMENT_TASK_PAGE_SIZE));
    const page = Math.max(0, Math.min(requestedPage, pages - 1));
    const start = page * ATTACHMENT_TASK_PAGE_SIZE;
    const end = Math.min(start + ATTACHMENT_TASK_PAGE_SIZE, segments.length);
    const selected = new Set(attachment.targetSegmentIndexes);
    const lines = [
      `📎 <b>Файл ${file + 1} из ${attachments.length}</b>`,
      escapeHtml(attachment.filename),
      '',
      'К каким задачам прикрепить? Можно выбрать несколько.',
    ];
    const rows: { text: string; callback_data: string }[][] = [];
    for (let seg = start; seg < end; seg++) {
      const item = segments[seg];
      if (!item) continue;
      const title = item.title.trim() || excerpt(item.body, 34);
      const state = selected.has(seg) ? '✅' : '⬜';
      const excluded = item.included ? '' : ' · исключена';
      rows.push([
        {
          text: `${state} ${seg + 1}. ${excerpt(mdToPlain(title), 34)}${excluded}`,
          callback_data: `fx:${draft.id}:${file}:${seg}:p${page}`,
        },
      ]);
    }
    if (pages > 1) {
      const nav: { text: string; callback_data: string }[] = [];
      if (page > 0) nav.push({ text: '◀ задачи', callback_data: `fs:${draft.id}:${file}:p${page - 1}` });
      nav.push({ text: `${page + 1}/${pages}`, callback_data: `fs:${draft.id}:${file}:p${page}` });
      if (page < pages - 1) {
        nav.push({ text: 'задачи ▶', callback_data: `fs:${draft.id}:${file}:p${page + 1}` });
      }
      rows.push(nav);
    }
    rows.push([
      { text: '🔗 Ко всем', callback_data: `fg:${draft.id}:${file}:a:p${page}` },
      { text: '🧹 Очистить', callback_data: `fg:${draft.id}:${file}:n:p${page}` },
    ]);
    const filesNav: { text: string; callback_data: string }[] = [];
    if (file > 0) filesNav.push({ text: '◀ файл', callback_data: `fs:${draft.id}:${file - 1}:p0` });
    filesNav.push({ text: `📎 ${file + 1}/${attachments.length}`, callback_data: `fs:${draft.id}:${file}:p${page}` });
    if (file < attachments.length - 1) {
      filesNav.push({ text: 'файл ▶', callback_data: `fs:${draft.id}:${file + 1}:p0` });
    }
    rows.push(filesNav);
    rows.push([{ text: '✅ Готово', callback_data: `fd:${draft.id}` }]);
    return { text: lines.join('\n'), replyMarkup: { inline_keyboard: rows } };
  }

  private async onFileOpen(
    cq: TelegramCallbackQuery,
    draft: TelegramTaskDraft,
    file: number,
    page: number,
    chatId: number,
    messageId: number | undefined,
  ): Promise<void> {
    const card = await this.renderAttachmentPicker(draft, file, page);
    if (messageId) await this.edit(chatId, messageId, card.text, card.replyMarkup);
    await this.deps.client.answerCallbackQuery(cq.id);
  }

  private async onFileToggle(
    cq: TelegramCallbackQuery,
    draft: TelegramTaskDraft,
    file: number,
    seg: number,
    page: number,
    chatId: number,
    messageId: number | undefined,
  ): Promise<void> {
    const item = draft.attachments[file];
    if (!item || !draft.segments?.[seg]) {
      await this.deps.client.answerCallbackQuery(cq.id, { text: 'Файл или задача уже недоступны.' });
      return;
    }
    const targets = new Set(item.targetSegmentIndexes);
    if (targets.has(seg)) targets.delete(seg);
    else targets.add(seg);
    const attachments = draft.attachments.slice();
    attachments[file] = { ...item, targetSegmentIndexes: [...targets].sort((a, b) => a - b) };
    const updated = (await this.deps.drafts.patch(draft.id, { attachments })) ?? draft;
    const card = await this.renderAttachmentPicker(updated, file, page);
    if (messageId) await this.edit(chatId, messageId, card.text, card.replyMarkup);
    await this.deps.client.answerCallbackQuery(cq.id);
  }

  private async onFileGroup(
    cq: TelegramCallbackQuery,
    draft: TelegramTaskDraft,
    file: number,
    selectAll: boolean,
    page: number,
    chatId: number,
    messageId: number | undefined,
  ): Promise<void> {
    const item = draft.attachments[file];
    if (!item) {
      await this.deps.client.answerCallbackQuery(cq.id, { text: 'Файл уже недоступен.' });
      return;
    }
    const attachments = draft.attachments.slice();
    attachments[file] = {
      ...item,
      targetSegmentIndexes: selectAll
        ? (draft.segments ?? []).flatMap((segment, index) => (segment.included ? [index] : []))
        : [],
    };
    const updated = (await this.deps.drafts.patch(draft.id, { attachments })) ?? draft;
    const card = await this.renderAttachmentPicker(updated, file, page);
    if (messageId) await this.edit(chatId, messageId, card.text, card.replyMarkup);
    await this.deps.client.answerCallbackQuery(cq.id, {
      text: selectAll ? 'Прикреплю ко всем включённым задачам' : 'Назначения очищены',
    });
  }

  private async onFileDone(
    cq: TelegramCallbackQuery,
    draft: TelegramTaskDraft,
    chatId: number,
    messageId: number | undefined,
  ): Promise<void> {
    const card = await this.renderSegmentsCard(draft);
    if (messageId) await this.edit(chatId, messageId, card.text, card.replyMarkup);
    await this.deps.client.answerCallbackQuery(cq.id);
  }

  // Под-карточка правки одного сегмента (проект / ответственный / срок / включение).
  private async renderSegmentEdit(draft: TelegramTaskDraft, idx: number): Promise<Card> {
    const segs = draft.segments ?? [];
    const seg = segs[idx];
    if (!seg) return this.renderSegmentsCard(draft);
    const multi = segs.length > 1;
    const projName = await this.projNameOf(seg.projectId);
    const assignee = await this.assigneeLabelOf(seg, draft.creatorUserId);
    const columnName = await this.columnLabelFor(seg.projectId, seg.targetStatus);
    const lines = [
      `✏️ <b>Задача ${idx + 1}</b>`,
      `📁 Проект: <b>${escapeHtml(projName)}</b>`,
      `📊 Колонка: <b>${escapeHtml(columnName)}</b>`,
      `👤 Ответственный: <b>${escapeHtml(assignee)}</b>`,
      `📅 Срок: <b>${seg.deadline ? escapeHtml(seg.deadline) : '—'}</b>`,
      '',
      `📝 ${markdownToTelegramHtml(excerpt(seg.body))}`,
    ];
    if (!seg.included) lines.push('\n🚫 <i>Исключена из создания</i>');
    const rows: { text: string; callback_data: string }[][] = [
      [
        { text: '📁 Проект', callback_data: `ap:${draft.id}:${idx}:?` },
        { text: '👤 Ответственный', callback_data: `ad:${draft.id}:${idx}:?` },
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
      { text: '👤 Назначить меня', callback_data: `ad:${draft.id}:${idx}:n` },
      { text: '⬅️ Назад', callback_data: `ae:${draft.id}:${idx}` },
    ]);
    return { text: `👤 Кто ответственный за задачу ${idx + 1}?`, replyMarkup: { inline_keyboard: rows } };
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

  private async onSegAssignee(
    cq: TelegramCallbackQuery,
    draft: TelegramTaskDraft,
    userId: string,
    idx: number,
    sel: AiAssigneeSel,
    chatId: number,
    messageId: number | undefined,
  ): Promise<void> {
    if (sel.type === 'open') {
      const seg = draft.segments?.[idx];
      const candidates = seg?.projectId
        ? (await this.deps.members.listByProject(seg.projectId)).map((m) => ({
            id: m.userId,
            displayName: m.user.displayName,
          }))
        : await this.deps.members.listSharedUsers(userId);
      const offered: TelegramDraftOffered = {
        ...(draft.offered?.projects ? { projects: draft.offered.projects } : {}),
        members: candidates.map((u) => ({ id: u.id, displayName: u.displayName })),
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
    cqId: string | null,
    opts: { readonly alreadyClaimed?: boolean; readonly automatic?: boolean } = {},
  ): Promise<void> {
    const claimed = opts.alreadyClaimed
      ? draft
      : await this.deps.drafts.claimForConfirmation(draft.id, false);
    if (!claimed) {
      if (cqId) {
        await this.deps.client.answerCallbackQuery(cqId, { text: 'Этот черновик уже обработан.' });
      }
      return;
    }
    draft = claimed;
    messageId ??= draft.tgMessageId ?? undefined;
    const segmentEntries = (draft.segments ?? [])
      .map((segment, index) => ({ segment, index }))
      .filter(({ segment }) => segment.included);
    if (segmentEntries.length === 0) {
      await this.deps.drafts.patch(draft.id, { status: 'cancelled' });
      if (cqId) {
        await this.deps.client.answerCallbackQuery(cqId, {
          text: 'Нет задач для создания.',
          showAlert: true,
        });
      }
      return;
    }
    let created = 0;
    let failed = 0;
    let lastTaskId: string | null = null;
    let lastProjectId: string | null = null;
    const createdTargets: {
      readonly segmentIndex: number;
      readonly taskId: string;
      readonly projectId: string;
      readonly description: string;
    }[] = [];
    const summary: string[] = [];
    for (const { segment: seg, index: segmentIndex } of segmentEntries) {
      try {
        const title = seg.title.trim();
        const body = seg.body.trim();
        const description = title ? `**${title}**\n\n${body}` : body;
        if (description.trim().length === 0) {
          failed += 1;
          continue;
        }
        const assigneeUserId =
          seg.assigneeUserId && seg.assigneeUserId !== userId ? seg.assigneeUserId : null;
        // No project resolved but somebody is responsible → the task belongs in the
        // ASSIGNEE's inbox, not the author's. Otherwise a delegated task silently rots in
        // the author's inbox and gets re-sent days later as a duplicate. Authorship
        // (ownerUserId → created_by) stays with the sender.
        const inboxOwnerId = assigneeUserId ?? userId;
        const delegatedInbox = !seg.projectId && inboxOwnerId !== userId;
        const targetId =
          seg.projectId ?? (await this.deps.getOrCreateInbox.execute(inboxOwnerId)).id;
        const task = await this.deps.createTask.execute({
          projectId: targetId,
          ownerUserId: userId,
          description,
          status: seg.targetStatus ?? DEFAULT_COLUMN,
          deadline: seg.deadline,
          assigneeUserId: assigneeUserId ?? userId,
          allowInboxDelegation: delegatedInbox,
        });
        created += 1;
        if (created === 1) {
          // Защита от дублей при падении на последующих сегментах/уведомлениях.
          await this.deps.drafts.patch(draft.id, { status: 'confirmed' });
        }
        createdTargets.push({ segmentIndex, taskId: task.id, projectId: targetId, description });
        lastTaskId = task.id;
        lastProjectId = targetId;
        const projName = await this.projNameOf(seg.projectId);
        if (assigneeUserId) {
          await this.notifySegmentAssignee(seg, task.id, targetId, userId, description);
        }
        summary.push(`✅ ${escapeHtml(title || excerpt(body, 40))} → <b>${escapeHtml(projName)}</b>`);
      } catch (err) {
        console.warn('[tg-composer] finalizeSegments: segment failed:', err);
        failed += 1;
        summary.push(`⚠️ ${escapeHtml(seg.title.trim() || excerpt(seg.body, 40))} — не удалось`);
      }
    }
    const downloadCache: AttachmentDownloadCache = new Map();
    let attachmentResult: AttachmentResult = { attached: 0, failed: 0 };
    for (const target of createdTargets) {
      const selected = draft.attachments.filter((attachment) =>
        attachment.targetSegmentIndexes.includes(target.segmentIndex),
      );
      const result = await this.attachDraftAttachments(
        selected,
        target.taskId,
        target.projectId,
        userId,
        target.description,
        downloadCache,
      );
      attachmentResult = {
        attached: attachmentResult.attached + result.attached,
        failed: attachmentResult.failed + result.failed,
      };
    }
    if (created === 0) await this.deps.drafts.releaseConfirmation(draft.id, AUTO_RETRY_SECONDS);
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
    const autoSuffix = opts.automatic && created > 0 ? ' · автоматически через 10 минут' : '';
    const header =
      (failed === 0 ? `✅ Создано задач: ${created}` : `Создано: ${created}, ошибок: ${failed}`) +
      autoSuffix;
    const attachmentSummary = this.attachmentResultText(attachmentResult).trim();
    if (messageId) {
      await this.edit(
        chatId,
        messageId,
        [header, attachmentSummary, '', ...summary].filter(Boolean).join('\n'),
      );
    }
    if (cqId) {
      await this.deps.client.answerCallbackQuery(cqId, {
        text: created > 0 ? 'Создано' : 'Не удалось — повторю через минуту',
      });
    }
  }

  // TG-уведомление ответственному сегмента: кнопки Завершить/Комментировать.
  private async notifySegmentAssignee(
    seg: TelegramDraftSegment,
    taskId: string,
    projectId: string,
    creatorUserId: string,
    description: string,
  ): Promise<void> {
    if (!seg.assigneeUserId) return;
    const creator = await this.deps.users.getById(creatorUserId);
    const creatorName = creator?.displayName ?? 'Коллега';
    const projName = await this.projNameOf(seg.projectId);
    const msg = `👤 <b>${escapeHtml(creatorName)}</b> назначил(а) тебя ответственным:\n📝 <i>${markdownToTelegramHtml(excerpt(description))}</i>. Проект: <b>${escapeHtml(projName)}</b>.`;
    const res = await this.deps.sendNotification.execute({
      userId: seg.assigneeUserId,
      text: msg,
      parseMode: 'HTML',
      kind: 'task_assignee_changed',
      taskId,
      replyMarkup: {
        inline_keyboard: [
          ...taskActionKeyboard(taskId).inline_keyboard,
          [{ text: 'Открыть в ProjectsFlow', url: `${this.deps.appUrl.replace(/\/$/, '')}/projects/${projectId}?task=${taskId}` }],
        ],
      },
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

  // Telegram files become ordinary task attachments. Native photos also remain figure blocks in
  // the description; documents (including an image explicitly sent "as file") stay files.
  // One failed download/upload never rolls back already created tasks.
  private async attachDraftAttachments(
    attachments: readonly TelegramDraftAttachment[],
    taskId: string,
    projectId: string,
    actorUserId: string,
    description: string,
    downloadCache: AttachmentDownloadCache = new Map(),
  ): Promise<AttachmentResult> {
    const download = this.deps.client.downloadFile?.bind(this.deps.client);
    const upload = this.deps.uploadAttachment;
    const update = this.deps.updateTask;
    if (attachments.length === 0) return { attached: 0, failed: 0 };
    if (!download || !upload) return { attached: 0, failed: attachments.length };

    const figures: string[] = [];
    let attached = 0;
    let failed = 0;
    for (const source of attachments) {
      try {
        let pending = downloadCache.get(source.key);
        if (!pending) {
          pending = download(source.fileId);
          downloadCache.set(source.key, pending);
        }
        const file = await pending;
        if (!file) {
          failed += 1;
          continue;
        }
        const attachment = await upload.execute({
          projectId,
          ownerUserId: actorUserId,
          taskId,
          filename: source.filename || file.filename,
          mimeType: source.mimeType || file.mimeType,
          data: file.data,
        });
        attached += 1;
        if (source.kind === 'photo') {
          figures.push(
            `<figure data-figure-image><img src="/api/attachments/${attachment.id}" alt="" /></figure>`,
          );
        }
      } catch (err) {
        failed += 1;
        console.warn('[tg-composer] Telegram attachment failed:', err);
      }
    }
    if (figures.length > 0 && update) {
      try {
        await update.execute({
          projectId,
          ownerUserId: actorUserId,
          taskId,
          description: `${description.trim()}\n\n${figures.join('\n\n')}`,
        });
      } catch (err) {
        console.warn('[tg-composer] Telegram photo description update failed:', err);
      }
    }
    return { attached, failed };
  }

  private attachmentResultText(result: AttachmentResult): string {
    if (result.attached === 0 && result.failed === 0) return '';
    const ok = result.attached > 0 ? `\n📎 Вложений прикреплено: ${result.attached}` : '';
    const failed = result.failed > 0 ? `\n⚠️ Не удалось прикрепить: ${result.failed}` : '';
    return `${ok}${failed}`;
  }

  // Шлёт сообщение и возвращает messageId (для спиннера / последующего edit). null при ошибке.
  private async sendReturningId(
    chatId: number,
    text: string,
    replyMarkup?: InlineKeyboardMarkup,
  ): Promise<number | null> {
    try {
      const res = await this.deps.client.sendMessage({
        chatId,
        text,
        parseMode: 'HTML',
        disableWebPagePreview: true,
        replyMarkup,
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
  ): Promise<number | null> {
    if (waitMsgId !== null) {
      await this.edit(chatId, waitMsgId, text, replyMarkup);
      return waitMsgId;
    }
    return this.sendReturningId(chatId, text, replyMarkup);
  }

  // Анимация ожидания: периодически редактирует сообщение кадрами брайля. Возвращает stop().
  // Рекурсивный setTimeout (не setInterval) — чтобы тики не накладывались, если edit подвис;
  // stop() гарантированно гасит таймер. Все edit'ы best-effort.
  private startSpinner(
    chatId: number,
    messageId: number,
    draftId: string,
  ): () => Promise<void> {
    let i = 0;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight: Promise<void> = Promise.resolve();
    const startedAt = Date.now();
    const tick = async (): Promise<void> => {
      if (stopped) return;
      const current = await this.deps.drafts.getById(draftId).catch(() => null);
      if (!current || current.status !== 'composing') {
        stopped = true;
        return;
      }
      i = (i + 1) % SPINNER_FRAMES.length;
      const sec = Math.round((Date.now() - startedAt) / 1000);
      // После >60с — явно говорим, что процесс идёт и ничего не зависло (большой промпт).
      const text =
        sec < 60
          ? `${SPINNER_FRAMES[i]} Перефразирую…`
          : `${SPINNER_FRAMES[i]} Большой промпт, обрабатываю… ничего не зависло (${sec}с)`;
      if (stopped) return;
      inFlight = this.deps.client
        .editMessageText({
          chatId,
          messageId,
          text,
          parseMode: 'HTML',
          disableWebPagePreview: true,
        })
        .catch(() => {});
      await inFlight;
      if (!stopped) timer = setTimeout(() => void tick(), SPINNER_INTERVAL_MS);
    };
    timer = setTimeout(() => void tick(), SPINNER_INTERVAL_MS);
    return async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      await inFlight;
    };
  }

  private async stopActiveSpinner(draftId: string): Promise<void> {
    await this.activeSpinners.get(draftId)?.();
    this.activeSpinners.delete(draftId);
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
