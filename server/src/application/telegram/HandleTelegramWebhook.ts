import type {
  TelegramClient,
  InlineKeyboardMarkup,
  SendRichMessageMediaInput,
} from './TelegramClient.js';
import type { TelegramRalphQuestionRepository } from './TelegramRalphQuestionRepository.js';
import type { TelegramTaskMessageRepository } from './TelegramTaskMessageRepository.js';
import type { TelegramGroupOwnerRepository } from './TelegramGroupOwnerRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { TaskAttachmentRepository } from '../task/TaskAttachmentRepository.js';
import type { AttachmentStorage } from '../task/AttachmentStorage.js';
import type { CreateTaskComment } from '../task/CreateTaskComment.js';
import type { MoveTask } from '../task/MoveTask.js';
import type { MaybeReopenForClarification } from '../task/MaybeReopenForClarification.js';
import {
  buildAssigneeMenu,
  buildAssigneeTaskCards,
  resolveAssigneeByName,
  collectAssigneeProjectTasks,
} from './assigneeBrowse.js';
import { parseComposerMessage } from './composer/parseComposerMessage.js';
import {
  buildWorkspaceAssigneeDigestMessage,
  buildWorkspaceAssigneeDigestRichMessage,
} from '../digest/SendWorkspaceAssigneeDigest.js';
import {
  taskActionKeyboard,
  taskCompletedKeyboard,
  closeProposalResolvedKeyboard,
} from './taskActionKeyboard.js';
import type { DispatchCommentNotifications } from '../notifications/DispatchCommentNotifications.js';
import type { ConfirmCloseProposal } from '../close-proposal/ConfirmCloseProposal.js';
import type { DismissCloseProposal } from '../close-proposal/DismissCloseProposal.js';
import type {
  TelegramComposerService,
  TelegramCallbackQuery,
  TelegramGroupContext,
} from './composer/TelegramComposerService.js';
import {
  getAllTgPrefsResolved,
  type TelegramNotificationPrefs,
} from '../../domain/telegram/TelegramNotificationPrefs.js';
import {
  stripAllMarkdown,
  extractImageSrcs,
  splitDescription,
} from '../../domain/task/digestFormat.js';
import { signAttachmentUrl } from '../attachments/signedAttachmentUrl.js';
import type { TelegramDraftAttachment } from './TelegramTaskDraftRepository.js';
import type { VoiceTranscriber } from './VoiceTranscriber.js';
import {
  buildTaskTelegramContent,
  buildTaskTelegramFallbackContent,
  buildTaskTelegramRichContent,
} from './taskTelegramContent.js';

// Signed task attachment URLs stay valid long enough for Telegram to fetch and cache media.
const TG_ATTACHMENT_URL_TTL_SECONDS = 14 * 24 * 60 * 60;

// Минимальный набор полей TG Update, которые мы реально обрабатываем (allowed_updates
// = message + callback_query + inline_query). Структура совпадает с Telegram Bot API:
// https://core.telegram.org/bots/api#update
export type TelegramUpdate = {
  readonly update_id: number;
  readonly message?: {
    readonly message_id: number;
    readonly from?: {
      readonly id: number;
      readonly username?: string;
      readonly first_name?: string;
      readonly last_name?: string;
    };
    // title — есть у group/supergroup (для атрибуции задачи-фолбэка).
    readonly chat: { readonly id: number; readonly type: string; readonly title?: string };
    readonly text?: string;
    readonly caption?: string;
    readonly media_group_id?: string;
    readonly photo?: readonly {
      readonly file_id: string;
      readonly file_unique_id?: string;
      readonly width: number;
      readonly height: number;
      readonly file_size?: number;
    }[];
    readonly document?: {
      readonly file_id: string;
      readonly file_unique_id?: string;
      readonly file_name?: string;
      readonly mime_type?: string;
      readonly file_size?: number;
    };
    readonly video?: {
      readonly file_id: string;
      readonly file_unique_id?: string;
      readonly width: number;
      readonly height: number;
      readonly duration: number;
      readonly file_name?: string;
      readonly mime_type?: string;
      readonly file_size?: number;
    };
    readonly audio?: {
      readonly file_id: string;
      readonly file_unique_id?: string;
      readonly duration: number;
      readonly file_name?: string;
      readonly mime_type?: string;
      readonly file_size?: number;
    };
    readonly voice?: {
      readonly file_id: string;
      readonly file_unique_id?: string;
      readonly duration: number;
      readonly mime_type?: string;
      readonly file_size?: number;
    };
    readonly animation?: {
      readonly file_id: string;
      readonly file_unique_id?: string;
      readonly width: number;
      readonly height: number;
      readonly duration: number;
      readonly file_name?: string;
      readonly mime_type?: string;
      readonly file_size?: number;
    };
    readonly video_note?: {
      readonly file_id: string;
      readonly file_unique_id?: string;
      readonly length: number;
      readonly duration: number;
      readonly file_size?: number;
    };
    // Reply на наше сообщение → ловим как ralph-answer ИЛИ комментарий к задаче. См. spec
    // C:/www/ralph/prompts/telegram-reply-to-ralph-answer.md.
    readonly reply_to_message?: {
      readonly message_id: number;
      readonly from?: { readonly id: number; readonly is_bot?: boolean };
    };
  };
  // Нажатие inline-кнопки (конструктор задач, Принять/Отказать, /tasks-навигация).
  readonly callback_query?: TelegramCallbackQuery;
  // Inline-режим (Phase D): `@ProjectsFlow_Bot ...` в поле ввода.
  readonly inline_query?: {
    readonly id: string;
    readonly from: { readonly id: number };
    readonly query: string;
  };
};

type TelegramMessage = NonNullable<TelegramUpdate['message']>;
type TelegramAttachmentKind = TelegramDraftAttachment['kind'];

function extensionForMime(mimeType: string): string {
  const normalized = mimeType.split(';', 1)[0]?.trim().toLowerCase();
  switch (normalized) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/gif':
      return 'gif';
    case 'video/mp4':
    case 'audio/mp4':
      return 'mp4';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/ogg':
      return 'ogg';
    default:
      return '';
  }
}

function fallbackFilename(
  kind: TelegramAttachmentKind,
  messageId: number,
  mimeType: string,
): string {
  const ext = extensionForMime(mimeType);
  return `telegram-${kind}-${messageId}${ext ? `.${ext}` : ''}`;
}

function largestPhoto(
  photos: NonNullable<NonNullable<TelegramUpdate['message']>['photo']> | undefined,
  messageId: number,
): TelegramDraftAttachment | null {
  if (!photos?.length) return null;
  const best = [...photos].sort((a, b) => {
    const sizeDiff = (b.file_size ?? 0) - (a.file_size ?? 0);
    return sizeDiff !== 0 ? sizeDiff : b.width * b.height - a.width * a.height;
  })[0];
  return best
    ? {
        key: best.file_unique_id ?? best.file_id,
        kind: 'photo',
        fileId: best.file_id,
        fileUniqueId: best.file_unique_id ?? null,
        filename: fallbackFilename('photo', messageId, 'image/jpeg'),
        mimeType: 'image/jpeg',
        width: best.width,
        height: best.height,
        duration: null,
        fileSize: best.file_size ?? null,
        targetSegmentIndexes: [],
      }
    : null;
}

function messageAttachments(msg: TelegramMessage): TelegramDraftAttachment[] {
  const out: TelegramDraftAttachment[] = [];
  const seen = new Set<string>();
  const add = (attachment: TelegramDraftAttachment | null): void => {
    if (!attachment) return;
    const key = attachment.fileUniqueId ?? attachment.fileId;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(attachment);
  };

  add(largestPhoto(msg.photo, msg.message_id));

  const addFile = (
    kind: TelegramAttachmentKind,
    file: {
      readonly file_id: string;
      readonly file_unique_id?: string;
      readonly file_name?: string;
      readonly mime_type?: string;
      readonly file_size?: number;
      readonly width?: number;
      readonly height?: number;
      readonly duration?: number;
    } | undefined,
    fallbackMimeType: string,
  ): void => {
    if (!file) return;
    const mimeType = file.mime_type?.trim() || fallbackMimeType;
    add({
      key: file.file_unique_id ?? file.file_id,
      kind,
      fileId: file.file_id,
      fileUniqueId: file.file_unique_id ?? null,
      filename: file.file_name?.trim() || fallbackFilename(kind, msg.message_id, mimeType),
      mimeType,
      fileSize: file.file_size ?? null,
      width: file.width ?? null,
      height: file.height ?? null,
      duration: file.duration ?? null,
      targetSegmentIndexes: [],
    });
  };

  // Telegram also exposes an animation as `document` for backwards compatibility. Add the
  // richer animation field first and deduplicate by file_unique_id/file_id.
  addFile('animation', msg.animation, msg.animation?.file_name?.toLowerCase().endsWith('.gif')
    ? 'image/gif'
    : 'video/mp4');
  addFile('video', msg.video, 'video/mp4');
  addFile('audio', msg.audio, 'audio/mpeg');
  addFile('voice', msg.voice, 'audio/ogg');
  if (msg.video_note) {
    add({
      key: msg.video_note.file_unique_id ?? msg.video_note.file_id,
      kind: 'video_note',
      fileId: msg.video_note.file_id,
      fileUniqueId: msg.video_note.file_unique_id ?? null,
      filename: fallbackFilename('video_note', msg.message_id, 'video/mp4'),
      mimeType: 'video/mp4',
      fileSize: msg.video_note.file_size ?? null,
      width: msg.video_note.length,
      height: msg.video_note.length,
      duration: msg.video_note.duration,
      targetSegmentIndexes: [],
    });
  }
  addFile('document', msg.document, 'application/octet-stream');
  return out;
}

function neutralMediaText(attachments: readonly TelegramDraftAttachment[]): string {
  if (attachments.length !== 1) return 'Файлы из Telegram';
  switch (attachments[0]?.kind) {
    case 'photo':
      return 'Фото из Telegram';
    case 'video':
    case 'video_note':
      return 'Видео из Telegram';
    case 'audio':
    case 'voice':
      return 'Аудио из Telegram';
    case 'animation':
      return 'Анимация из Telegram';
    default:
      return 'Файл из Telegram';
  }
}

type Deps = {
  readonly users: UserRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly attachments: TaskAttachmentRepository;
  readonly attachmentStorage: Pick<AttachmentStorage, 'read'>;
  readonly client: TelegramClient;
  readonly appUrl: string;
  // Signs task attachment URLs because Telegram fetches them without an app session.
  readonly signingSecret: string;
  readonly botUsername: string | null;
  // Reply→ralph-answer ветка. См. spec telegram-reply-to-ralph-answer.md.
  readonly ralphQuestionMessages: TelegramRalphQuestionRepository;
  // Reply→обычный комментарий: маппинг task-сообщений бота → задача (db/049).
  readonly taskMessages: TelegramTaskMessageRepository;
  // Привязка группового чата к владельцу (db/099) — для гибрид-маршрутизации задач из групп.
  readonly groupOwners: TelegramGroupOwnerRepository;
  readonly createComment: CreateTaskComment;
  // Инлайн «✅ Завершить» / «↩️ Отменить» на задачных уведомлениях (nd:/nu: callback).
  readonly moveTask: MoveTask;
  // Инлайн «✅ Закрыть» / «✕ Не она» на предложениях закрыть (pd:/px: callback, db/101).
  readonly confirmCloseProposal: ConfirmCloseProposal;
  readonly dismissCloseProposal: DismissCloseProposal;
  // Рассылка email+TG участникам по комментарию (как HTTP-роут). Best-effort.
  readonly dispatchCommentNotifications: DispatchCommentNotifications;
  // Конструктор задач (+проект текст @ответственный) + обработка его кнопок.
  readonly composer: TelegramComposerService;
  // Bare voice messages in a linked work group are transcribed and enter the same task composer.
  // Optional so deployments without a speech provider keep the previous mention-only behavior.
  readonly voiceTranscriber?: VoiceTranscriber;
  readonly maybeReopenForClarification: MaybeReopenForClarification;
  // Live-обновление UI после auto-create комментария / auto-return статуса.
  // Best-effort — webhook не блокирует ответ на SSE.
  readonly notifyTaskChanged: (projectId: string) => void;
  readonly notifyCommentAdded: (
    projectId: string,
    taskId: string,
    commentId: string,
    ownerUserId: string,
    actorKind?: 'user' | 'agent' | 'system',
    agentName?: string | null,
  ) => void;
  readonly notifyStatusChanged: (
    projectId: string,
    taskId: string,
    oldStatus: string,
    newStatus: string,
    actorUserId: string,
  ) => void;
};

// Роутер команд бота. Сами reply'и шлём через TelegramClient.sendMessage — best-effort,
// если отвалится — следующий /start попробует снова.
export class HandleTelegramWebhook {
  private readonly mediaGroups = new Map<
    string,
    {
      message: TelegramMessage;
      attachments: Map<
        string,
        { readonly attachment: TelegramDraftAttachment; readonly messageId: number }
      >;
      timer: ReturnType<typeof setTimeout>;
      waiters: Array<{ readonly resolve: () => void; readonly reject: (error: unknown) => void }>;
    }
  >();
  private readonly processedVoiceSources = new Map<string, number>();

  constructor(private readonly deps: Deps) {}

  async execute(update: TelegramUpdate): Promise<void> {
    // Нажатие inline-кнопки. `bt:` — навигация /tasks (наш handler); остальное (tp/td/
    // tc/tx/a*/ts) — конструктор задач. Легаси da:/dd: гаснут в композере молча.
    if (update.callback_query) {
      const cq = update.callback_query;
      const data = cq.data ?? '';
      // Действия задачных уведомлений (nd/nc/nu) — до фолбэка на композер.
      if (data.startsWith('nd:')) return this.handleTaskDone(cq, data.slice(3));
      if (data.startsWith('dg:')) return this.handleDigestTaskDone(cq, data.slice(3));
      if (data.startsWith('nc:')) return this.handleTaskCommentPrompt(cq, data.slice(3));
      if (data.startsWith('nu:')) return this.handleTaskUndo(cq, data.slice(3));
      // Предложения закрыть (db/101): pd: подтвердить, px: отклонить.
      if (data.startsWith('pd:')) return this.handleCloseProposalConfirm(cq, data.slice(3));
      if (data.startsWith('px:')) return this.handleCloseProposalDismiss(cq, data.slice(3));
      if (data.startsWith('ba:')) return this.handleAssigneeCallback(cq);
      if (data.startsWith('bt:')) return this.handleBrowseCallback(cq);
      return this.deps.composer.handleCallback(cq);
    }
    // Inline-режим (Phase D).
    if (update.inline_query) {
      return this.handleInlineQuery(
        update.inline_query.id,
        update.inline_query.from.id,
        update.inline_query.query,
      );
    }

    const msg = update.message;
    if (!msg || !msg.from) return;
    const attachments = messageAttachments(msg);
    if (msg.media_group_id && attachments.length > 0) {
      return this.queueMediaGroup(msg, attachments);
    }
    return this.handleMessage(
      msg,
      attachments,
      `m:${msg.chat.id}:${msg.message_id}`,
    );
  }

  private async handleMessage(
    msg: TelegramMessage,
    attachments: readonly TelegramDraftAttachment[],
    sourceKey: string,
  ): Promise<void> {
    if (!msg.from) return;

    let text = (msg.text ?? msg.caption ?? '').trim();
    const tgUserId = msg.from.id;
    const chatId = msg.chat.id;

    const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';

    // Voice messages are the one deliberate exception to the group mention gate. Only a group
    // explicitly linked to a ProjectsFlow account is considered a work chat; unrelated groups
    // remain silent. The composer is invoked directly because Telegram does not deliver a bot's
    // own outgoing transcription back to that bot as a new update.
    if (isGroup && msg.voice && this.deps.voiceTranscriber?.enabled) {
      const ownerUserId = await this.deps.groupOwners.getOwnerUserId(chatId);
      if (ownerUserId !== null) {
        return this.handleGroupVoice(msg, attachments, sourceKey, ownerUserId);
      }
    }

    // В групповых чатах бот реагирует ТОЛЬКО когда к нему обращаются: упоминание
    // @<botUsername> в тексте ИЛИ reply на сообщение самого бота. Иначе молчим — иначе он
    // отвечал бы на каждое сообщение группы. Личка (private) — без ограничений.
    if (isGroup) {
      const bu = this.deps.botUsername;
      const repliedToBot = msg.reply_to_message?.from?.is_bot === true;
      const mentioned = bu ? new RegExp('@' + bu + '\\b', 'i').test(text) : false;
      if (!repliedToBot && !mentioned) return;
      // Вырезаем @упоминание из текста: чтобы оно не попало в текст задачи и чтобы команды
      // вида «/help@BotName» (так TG шлёт команды в группах) распознавались как «/help».
      if (bu) text = text.replace(new RegExp('@' + bu, 'ig'), '').replace(/\s+/g, ' ').trim();
    }

    // Стикеры/геолокации/служебные message без текста и без поддерживаемого файла игнорируем.
    if (!isGroup && text.length === 0 && attachments.length === 0) return;

    // Медиа может прийти без caption. Это всё равно полноценная задача: даём ей нейтральный
    // текст, а бинарник сохраняем как обычное вложение. В группе делаем это после удаления
    // @упоминания, чтобы «@Bot + файл» не превратился в меню задач.
    if (text.length === 0 && attachments.length > 0) text = neutralMediaText(attachments);

    // Reply→ralph-answer / комментарий ловим ДО командного роутинга — юзер может reply'нуть
    // просто текстом, без слэш-префикса (типичный TG UX).
    if (msg.reply_to_message?.message_id) {
      return this.handleReply(tgUserId, chatId, msg.reply_to_message.message_id, text);
    }

    // «Пустое» @упоминание в группе (только @bot, без другого текста) → меню задач
    // «по ответственным» в охвате ВЛАДЕЛЬЦА привязки группы (telegram_group_owners).
    // Сюда попадаем только если бот был упомянут/reply'нут (гейт isGroup выше), а после
    // вырезания @упоминания текст пуст. Упоминание с текстом — ниже, composer как раньше.
    if (isGroup && text.length === 0 && attachments.length === 0) {
      return this.handleGroupAssigneeMenu(chatId);
    }

    // «@Человек» без текста задачи (в группе @упоминание бота уже вырезано выше) → сводка
    // открытых задач этого человека по проектам. «@Человек» С текстом («купить молоко @Ваня»)
    // — это создание задачи (композер ниже), сюда НЕ попадает.
    if (attachments.length === 0) {
      const parsed = parseComposerMessage(text);
      if (parsed.assigneeQuery !== null && parsed.taskText.trim().length === 0) {
        return this.handleAssigneeTasksRequest(chatId, tgUserId, isGroup, parsed.assigneeQuery);
      }
    }

    // Routing по первому слову.
    const cmd = text.split(/\s+/, 1)[0]?.toLowerCase() ?? '';
    // В группе /start привязывает чат к аккаунту отправителя (а не трогает его личный DM-чат).
    if (cmd === '/start')
      return isGroup
        ? this.handleGroupStart(tgUserId, chatId)
        : this.handleStart(tgUserId, chatId, msg.from.first_name);
    if (cmd === '/pause') return this.handlePause(tgUserId, chatId);
    if (cmd === '/pending') return this.handlePending(tgUserId, chatId);
    if (cmd === '/tasks') return this.handleTasks(tgUserId, chatId);
    if (cmd === '/help') return this.handleHelp(chatId);
    // Неизвестная slash-команда — не превращаем в задачу.
    if (cmd.startsWith('/')) return this.handleHelp(chatId);
    // Любой прочий текст → черновик задачи (фаза «любой текст = задача»). Без `+проекта`
    // уходит во «Входящие»; с `+проект`/`@ответственный` — конструктор уточнит кнопками. В группе
    // передаём groupCtx: композер решает — создавать «как отправитель» или уронить в «Входящие»
    // владельца группы (гибрид-маршрутизация, см. spec telegram-group-multi-user-tasks).
    if (isGroup) {
      const groupCtx: TelegramGroupContext = {
        ownerUserId: await this.deps.groupOwners.getOwnerUserId(chatId),
        senderName: formatSenderName(msg.from),
        groupTitle: msg.chat.title ?? null,
      };
      return this.deps.composer.startFromMessage(tgUserId, chatId, text, groupCtx, attachments, {
        sourceKey,
        background: true,
      });
    }
    return this.deps.composer.startFromMessage(tgUserId, chatId, text, undefined, attachments, {
      sourceKey,
      background: true,
    });
  }

  private async handleGroupVoice(
    msg: TelegramMessage,
    attachments: readonly TelegramDraftAttachment[],
    sourceKey: string,
    ownerUserId: string,
  ): Promise<void> {
    if (!msg.from || !msg.voice || !this.deps.voiceTranscriber) return;
    if (this.wasVoiceSourceProcessed(sourceKey)) return;
    this.processedVoiceSources.set(sourceKey, Date.now());

    try {
      const downloaded = await this.deps.client.downloadFile?.(msg.voice.file_id);
      if (!downloaded) throw new Error('Telegram voice file could not be downloaded');

      const transcript = await this.deps.voiceTranscriber.transcribe({
        data: downloaded.data,
        filename: downloaded.filename || fallbackFilename('voice', msg.message_id, 'audio/ogg'),
        mimeType: msg.voice.mime_type?.trim() || downloaded.mimeType || 'audio/ogg',
      });

      const botLabel = this.deps.botUsername?.trim()
        ? `@${escapeHtml(this.deps.botUsername.replace(/^@/, ''))}`
        : 'ProjectsFlow Bot';
      const preview = excerptVoiceTranscript(transcript, 3_000);
      await this.reply(
        msg.chat.id,
        `🎙 <b>Расшифровка голосового</b>\n` +
          `<blockquote>${escapeHtml(preview)}</blockquote>\n` +
          `🆕 <b>Новая задача</b> · ${botLabel}\n` +
          `<i>Переформулирую и предложу создать её ниже.</i>`,
      );

      const groupCtx: TelegramGroupContext = {
        ownerUserId,
        senderName: formatSenderName(msg.from),
        groupTitle: msg.chat.title ?? null,
      };
      await this.deps.composer.startFromMessage(
        msg.from.id,
        msg.chat.id,
        transcript,
        groupCtx,
        attachments,
        { sourceKey, background: true },
      );
    } catch (err) {
      this.processedVoiceSources.delete(sourceKey);
      console.warn('[tg-webhook] voice transcription failed:', err);
      await this.reply(
        msg.chat.id,
        '⚠️ Не удалось расшифровать голосовое. Отправьте его ещё раз или напишите задачу текстом.',
      );
    }
  }

  private wasVoiceSourceProcessed(sourceKey: string): boolean {
    const now = Date.now();
    const ttlMs = 24 * 60 * 60 * 1_000;
    for (const [key, processedAt] of this.processedVoiceSources) {
      if (now - processedAt > ttlMs) this.processedVoiceSources.delete(key);
    }
    return this.processedVoiceSources.has(sourceKey);
  }

  // Telegram присылает альбом как несколько update с общим media_group_id, причём caption
  // обычно есть только у одного. Небольшой debounce собирает фото/видео/аудио/документы в один
  // durable intake. Promise каждого update завершается только после handleMessage: вызывающий
  // webhook/poller может подтверждать update уже после сохранения черновика.
  private queueMediaGroup(
    msg: TelegramMessage,
    attachments: readonly TelegramDraftAttachment[],
  ): Promise<void> {
    if (!msg.from || !msg.media_group_id) return Promise.resolve();
    const key = `${msg.chat.id}:${msg.from.id}:${msg.media_group_id}`;
    return new Promise<void>((resolve, reject) => {
      const current = this.mediaGroups.get(key);
      if (current) {
        clearTimeout(current.timer);
        for (const attachment of attachments) {
          const attachmentKey = attachment.fileUniqueId ?? attachment.fileId;
          if (!current.attachments.has(attachmentKey)) {
            current.attachments.set(attachmentKey, {
              attachment,
              messageId: msg.message_id,
            });
          }
        }
        if (!current.message.caption && msg.caption) current.message = msg;
        current.waiters.push({ resolve, reject });
        current.timer = setTimeout(() => void this.flushMediaGroup(key), 1_000);
        return;
      }
      const media = new Map<
        string,
        { readonly attachment: TelegramDraftAttachment; readonly messageId: number }
      >();
      for (const attachment of attachments) {
        media.set(attachment.fileUniqueId ?? attachment.fileId, {
          attachment,
          messageId: msg.message_id,
        });
      }
      const entry = {
        message: msg,
        attachments: media,
        timer: setTimeout(() => void this.flushMediaGroup(key), 1_000),
        waiters: [{ resolve, reject }],
      };
      this.mediaGroups.set(key, entry);
    });
  }

  private async flushMediaGroup(key: string): Promise<void> {
    const entry = this.mediaGroups.get(key);
    if (!entry) return;
    this.mediaGroups.delete(key);
    const attachments = [...entry.attachments.values()]
      .sort((a, b) => a.messageId - b.messageId)
      .map(({ attachment }) => attachment);
    try {
      await this.handleMessage(
        entry.message,
        attachments,
        `g:${key}`,
      );
      for (const waiter of entry.waiters) waiter.resolve();
    } catch (err) {
      console.warn('[tg-webhook] media group failed:', err);
      for (const waiter of entry.waiters) waiter.reject(err);
    }
  }

  // Reply на наше сообщение → ralph-answer комментарий в задаче. Шаги:
  //   1. Найти маппинг (chat, message) → (task, question, recipient).
  //   2. Проверить что отправитель == адресат (нельзя отвечать за другого).
  //   3. Создать коммент с маркером <!-- ralph-answer {...} --> от лица юзера.
  //   4. Триггернуть MaybeReopenForClarification (auto-return awaiting → in_progress).
  //   5. SSE comment_added + (если был возврат) task_status_changed.
  //   6. TG-подтверждение юзеру.
  // На любой неуспех — отвечаем понятным текстом, не падаем (TG retry'ит 5xx лавиной).
  private async handleReply(
    tgUserId: number,
    chatId: number,
    replyToMessageId: number,
    text: string,
  ): Promise<void> {
    const mapping = await this.deps.ralphQuestionMessages.findByMessage(chatId, replyToMessageId);
    if (!mapping) {
      // Не ralph-question → пробуем как обычный комментарий к задаче (reply на карточку
      // конструктора / назначения ответственного / /tasks). См. handleTaskReplyComment.
      return this.handleTaskReplyComment(tgUserId, chatId, replyToMessageId, text);
    }

    const senderUserId = await this.deps.users.findUserIdByTelegramUserId(tgUserId);
    if (!senderUserId || senderUserId !== mapping.recipientUserId) {
      // Защита от того что чужой TG-аккаунт отвечает на чужое уточнение (после share
      // chat'а, например). По spec'е — отвечает только адресат.
      await this.reply(chatId, '🚫 Ответить на это уточнение может только адресат.');
      return;
    }

    // Грузим задачу — нужен projectId для CreateTaskComment.
    const task = await this.deps.tasks.getById(mapping.taskId);
    if (!task) {
      await this.reply(chatId, '⚠️ Задача удалена. Уточнение больше неактуально.');
      return;
    }

    // Body коммента: видимая шапка + markdown с ответом + machine-readable маркер.
    // Маркер парсится Ralph-диспетчером через Scan-PfAnswers и сервером через
    // MaybeReopenForClarification (substring '<!-- ralph-answer '). Поэтому формат и
    // пробелы важны.
    const answerPayload = {
      v: 1,
      q: mapping.ralphQuestionId,
      value: text,
      source: 'tg-reply-projectsflow-bot',
      answeredAt: new Date().toISOString(),
    };
    const body =
      `**✅ Ответ на уточнение** (через Telegram reply)\n\n${text}\n\n` +
      `<!-- ralph-answer ${JSON.stringify(answerPayload)} -->`;

    let comment;
    try {
      comment = await this.deps.createComment.execute({
        projectId: task.projectId,
        ownerUserId: senderUserId,
        taskId: task.id,
        body,
        // ВАЖНО: это ответ ЧЕЛОВЕКА. Без явного 'user' default бы тоже сработал, но
        // фиксируем явно — чтобы случайно не отрисовать Claude-стиль на этом комменте.
        actorKind: 'user',
      });
    } catch (err) {
      console.warn('[tg-webhook] createComment failed for reply:', err);
      await this.reply(
        chatId,
        '❌ Не удалось сохранить ответ (внутренняя ошибка). Попробуйте через интерфейс ProjectsFlow.',
      );
      return;
    }

    // SSE: новый коммент видят все участники проекта мгновенно.
    this.deps.notifyCommentAdded(
      task.projectId,
      task.id,
      comment.id,
      senderUserId,
      'user',
      null,
    );

    // Auto-return awaiting_clarification → in_progress. Best-effort.
    try {
      const reopened = await this.deps.maybeReopenForClarification.execute(
        task.id,
        body,
        senderUserId,
      );
      if (reopened) {
        this.deps.notifyStatusChanged(
          task.projectId,
          task.id,
          reopened.oldStatus,
          reopened.newStatus,
          senderUserId,
        );
      }
    } catch (err) {
      console.warn('[tg-webhook] auto-reopen failed:', err);
    }
    this.deps.notifyTaskChanged(task.projectId);

    // Подтверждение юзеру. Урезаем текст до 80 символов чтоб не повторять простыню.
    const preview = text.length > 80 ? text.slice(0, 79).trimEnd() + '…' : text;
    await this.reply(
      chatId,
      `✅ Принято: <i>${escapeHtml(preview)}</i>\n\nЗадача возвращена в работу.`,
    );
  }

  // --- Инлайн-действия задачных уведомлений (nd/nc/nu) — email-аналог «Завершить/Комментировать»
  //     прямо в чате, без авторизации и редиректа (TG-аккаунт уже привязан к юзеру). ---

  private async answerNeedsLink(cqId: string): Promise<void> {
    await this.deps.client.answerCallbackQuery(cqId, {
      text: 'Сначала привяжи Telegram: в профиле на сайте нажми «Login with Telegram», затем /start.',
      showAlert: true,
    });
  }

  // Общий гейт callback'а: резолв юзера + задача + членство. null → уже ответили alert'ом.
  private async resolveTaskAction(
    cq: TelegramCallbackQuery,
    taskId: string,
  ): Promise<{ userId: string; task: NonNullable<Awaited<ReturnType<TaskRepository['getById']>>> } | null> {
    const userId = await this.deps.users.findUserIdByTelegramUserId(cq.from.id);
    if (!userId) {
      await this.answerNeedsLink(cq.id);
      return null;
    }
    const task = await this.deps.tasks.getById(taskId);
    if (!task) {
      await this.deps.client.answerCallbackQuery(cq.id, { text: 'Задача удалена.', showAlert: true });
      return null;
    }
    const membership = await this.deps.members.findForProject(task.projectId, userId);
    if (!membership) {
      await this.deps.client.answerCallbackQuery(cq.id, { text: 'Нет доступа к задаче.', showAlert: true });
      return null;
    }
    return { userId, task };
  }

  // Карточка задачи (после «Отменить» / для повторного показа действий).
  private async renderTaskCard(chatId: number, messageId: number, task: { description: string | null }, taskId: string): Promise<void> {
    await this.deps.client.editMessageText({
      chatId,
      messageId,
      text: `📌 ${escapeHtml(excerptShort(task.description, 300))}`,
      parseMode: 'HTML',
      disableWebPagePreview: true,
      replyMarkup: taskActionKeyboard(taskId),
    });
  }

  // Карточка «завершено» с кнопкой отмены.
  private async renderCompleted(
    chatId: number,
    messageId: number,
    description: string | null,
    name: string | null,
    taskId: string,
  ): Promise<void> {
    const who = name ? ` · ${escapeHtml(name)}` : '';
    await this.deps.client.editMessageText({
      chatId,
      messageId,
      text: `✅ <b>Завершено</b>${who}\n${escapeHtml(excerptShort(description, 300))}`,
      parseMode: 'HTML',
      disableWebPagePreview: true,
      replyMarkup: taskCompletedKeyboard(taskId),
    });
  }

  // «✅ Завершить»: помечаем задачу done, перерисовываем сообщение + кнопку «Отменить».
  private async handleTaskDone(cq: TelegramCallbackQuery, taskId: string): Promise<void> {
    const chatId = cq.message?.chat.id ?? cq.from.id;
    const messageId = cq.message?.message_id ?? null;
    const ctx = await this.resolveTaskAction(cq, taskId);
    if (!ctx) return;
    const { userId, task } = ctx;
    if (task.status === 'done') {
      await this.deps.client.answerCallbackQuery(cq.id, { text: 'Уже завершена.' });
      if (messageId !== null) await this.renderCompleted(chatId, messageId, task.description, null, taskId);
      return;
    }
    try {
      await this.deps.moveTask.execute({
        projectId: task.projectId,
        ownerUserId: userId,
        taskId,
        targetStatus: 'done',
        beforeTaskId: null,
        afterTaskId: null,
      });
    } catch (err) {
      console.warn('[tg-webhook] task complete failed:', err);
      await this.deps.client.answerCallbackQuery(cq.id, { text: 'Не удалось завершить.', showAlert: true });
      return;
    }
    await this.deps.client.answerCallbackQuery(cq.id, { text: '✅ Завершено' });
    const name = (await this.deps.users.getById(userId).catch(() => null))?.displayName ?? null;
    if (messageId !== null) await this.renderCompleted(chatId, messageId, task.description, name, taskId);
    this.deps.notifyStatusChanged(task.projectId, taskId, task.status, 'done', userId);
    this.deps.notifyTaskChanged(task.projectId);
  }

  // Compact daily-digest action. Unlike a single-task notification, a digest contains many
  // tasks, so completing one row must not replace the entire message or its other buttons.
  private async handleDigestTaskDone(
    cq: TelegramCallbackQuery,
    taskId: string,
  ): Promise<void> {
    const ctx = await this.resolveTaskAction(cq, taskId);
    if (!ctx) return;
    const { userId, task } = ctx;
    if (task.status === 'done') {
      await this.deps.client.answerCallbackQuery(cq.id, { text: 'Уже завершена.' });
      return;
    }
    try {
      await this.deps.moveTask.execute({
        projectId: task.projectId,
        ownerUserId: userId,
        taskId,
        targetStatus: 'done',
        beforeTaskId: null,
        afterTaskId: null,
      });
    } catch (err) {
      console.warn('[tg-webhook] digest task complete failed:', err);
      await this.deps.client.answerCallbackQuery(cq.id, {
        text: 'Не удалось завершить задачу.',
        showAlert: true,
      });
      return;
    }
    await this.deps.client.answerCallbackQuery(cq.id, { text: '✓ Задача завершена' });
    this.deps.notifyStatusChanged(task.projectId, taskId, task.status, 'done', userId);
    this.deps.notifyTaskChanged(task.projectId);
  }

  // «↩️ Отменить»: возвращаем задачу из done в прежний статус (status_before_done).
  private async handleTaskUndo(cq: TelegramCallbackQuery, taskId: string): Promise<void> {
    const chatId = cq.message?.chat.id ?? cq.from.id;
    const messageId = cq.message?.message_id ?? null;
    const ctx = await this.resolveTaskAction(cq, taskId);
    if (!ctx) return;
    const { userId, task } = ctx;
    if (task.status !== 'done') {
      await this.deps.client.answerCallbackQuery(cq.id, { text: 'Уже в работе.' });
      if (messageId !== null) await this.renderTaskCard(chatId, messageId, task, taskId);
      return;
    }
    const target = task.statusBeforeDone ?? 'todo';
    try {
      await this.deps.moveTask.execute({
        projectId: task.projectId,
        ownerUserId: userId,
        taskId,
        targetStatus: target,
        beforeTaskId: null,
        afterTaskId: null,
        restore: true,
      });
    } catch (err) {
      console.warn('[tg-webhook] task undo failed:', err);
      await this.deps.client.answerCallbackQuery(cq.id, { text: 'Не удалось отменить.', showAlert: true });
      return;
    }
    await this.deps.client.answerCallbackQuery(cq.id, { text: '↩️ Возвращено' });
    if (messageId !== null) await this.renderTaskCard(chatId, messageId, task, taskId);
    this.deps.notifyStatusChanged(task.projectId, taskId, 'done', target, userId);
    this.deps.notifyTaskChanged(task.projectId);
  }

  // «✅ Закрыть» на предложении (db/101): подтверждает закрытие. Любой участник (viewer+).
  private async handleCloseProposalConfirm(
    cq: TelegramCallbackQuery,
    proposalId: string,
  ): Promise<void> {
    const chatId = cq.message?.chat.id ?? cq.from.id;
    const messageId = cq.message?.message_id ?? null;
    const userId = await this.deps.users.findUserIdByTelegramUserId(cq.from.id);
    if (!userId) {
      await this.answerNeedsLink(cq.id);
      return;
    }
    let result;
    try {
      result = await this.deps.confirmCloseProposal.execute({ proposalId, userId });
    } catch (err) {
      console.warn('[tg-webhook] close-proposal confirm failed:', err);
      await this.deps.client.answerCallbackQuery(cq.id, { text: 'Предложение не найдено.', showAlert: true });
      return;
    }
    if (result.status === 'not_member') {
      await this.deps.client.answerCallbackQuery(cq.id, { text: 'Нет доступа к проекту.', showAlert: true });
      return;
    }
    const name = (await this.deps.users.getById(userId).catch(() => null))?.displayName ?? null;
    const who = name ? ` · ${escapeHtml(name)}` : '';
    await this.deps.client.answerCallbackQuery(cq.id, {
      text: result.status === 'confirmed' ? '✅ Закрыто' : 'Уже обработано',
    });
    if (messageId !== null) {
      await this.deps.client
        .editMessageText({
          chatId,
          messageId,
          text: `✅ <b>Задача закрыта</b>${who}`,
          parseMode: 'HTML',
          disableWebPagePreview: true,
          replyMarkup: closeProposalResolvedKeyboard(),
        })
        .catch(() => {});
    }
    if (result.status === 'confirmed') this.deps.notifyTaskChanged(result.proposal.projectId);
  }

  // «✕ Не она» на предложении (db/101): отклоняет. Задача остаётся, повторно не предлагаем.
  private async handleCloseProposalDismiss(
    cq: TelegramCallbackQuery,
    proposalId: string,
  ): Promise<void> {
    const chatId = cq.message?.chat.id ?? cq.from.id;
    const messageId = cq.message?.message_id ?? null;
    const userId = await this.deps.users.findUserIdByTelegramUserId(cq.from.id);
    if (!userId) {
      await this.answerNeedsLink(cq.id);
      return;
    }
    let result;
    try {
      result = await this.deps.dismissCloseProposal.execute({ proposalId, userId });
    } catch (err) {
      console.warn('[tg-webhook] close-proposal dismiss failed:', err);
      await this.deps.client.answerCallbackQuery(cq.id, { text: 'Предложение не найдено.', showAlert: true });
      return;
    }
    if (result.status === 'not_member') {
      await this.deps.client.answerCallbackQuery(cq.id, { text: 'Нет доступа к проекту.', showAlert: true });
      return;
    }
    await this.deps.client.answerCallbackQuery(cq.id, { text: '✕ Оставлено открытым' });
    if (messageId !== null) {
      await this.deps.client
        .editMessageText({
          chatId,
          messageId,
          text: '✕ <b>Оставлено открытым</b> — задача не закрыта.',
          parseMode: 'HTML',
          disableWebPagePreview: true,
          replyMarkup: closeProposalResolvedKeyboard(),
        })
        .catch(() => {});
    }
  }

  // «💬 Комментировать»: шлём force-reply приглашение, привязанное к задаче. Ответ юзера
  // ловит handleReply → handleTaskReplyComment (комментарий + рассылка участникам).
  private async handleTaskCommentPrompt(cq: TelegramCallbackQuery, taskId: string): Promise<void> {
    const chatId = cq.message?.chat.id ?? cq.from.id;
    const ctx = await this.resolveTaskAction(cq, taskId);
    if (!ctx) return;
    const { userId, task } = ctx;
    await this.deps.client.answerCallbackQuery(cq.id);
    let res;
    try {
      res = await this.deps.client.sendMessage({
        chatId,
        text: `✍️ Комментарий к «${escapeHtml(excerptShort(task.description, 80))}» — ответьте на это сообщение:`,
        parseMode: 'HTML',
        disableWebPagePreview: true,
        replyMarkup: { force_reply: true, input_field_placeholder: 'Ваш комментарий…' },
      });
    } catch (err) {
      console.warn('[tg-webhook] comment prompt send failed:', err);
      return;
    }
    if (res.kind === 'ok') {
      try {
        await this.deps.taskMessages.upsert({
          tgChatId: chatId,
          tgMessageId: res.messageId,
          recipientUserId: userId,
          taskId,
          projectId: task.projectId,
        });
      } catch (err) {
        console.warn('[tg-webhook] comment prompt taskMessage upsert failed:', err);
      }
    }
  }

  private async handleStart(
    tgUserId: number,
    chatId: number,
    firstName: string | undefined,
  ): Promise<void> {
    const userId = await this.deps.users.findUserIdByTelegramUserId(tgUserId);
    if (!userId) {
      const profileUrl = `${this.deps.appUrl.replace(/\/$/, '')}/profile`;
      await this.reply(
        chatId,
        `👋 Привет! Чтобы получать уведомления, сначала зайди на <a href="${profileUrl}">${profileUrl}</a> и привяжи Telegram через кнопку «Login with Telegram».`,
      );
      return;
    }
    await this.deps.users.markTelegramStarted(userId, chatId);
    const name = firstName ? `, ${firstName}` : '';
    await this.reply(
      chatId,
      `✅ Готово${name}! Бот подключён ко всему твоему аккаунту — доступны все проекты.\n\n` +
        `📝 Чтобы создать задачу, просто напиши мне текст — она уйдёт во «Входящие». ` +
        `Для конкретного проекта: <code>+Проект текст</code>.\n\n` +
        `Все возможности — /help`,
    );
  }

  // /start в группе → привязка чата к аккаунту отправителя (first-writer-wins). НЕ трогаем
  // личный DM-чат владельца (markTelegramStarted): это ЛС-функция, увела бы уведомления в группу.
  private async handleGroupStart(tgUserId: number, chatId: number): Promise<void> {
    const userId = await this.deps.users.findUserIdByTelegramUserId(tgUserId);
    if (!userId) {
      const profileUrl = `${this.deps.appUrl.replace(/\/$/, '')}/profile`;
      await this.reply(
        chatId,
        `👋 Сначала привяжи Telegram: на <a href="${profileUrl}">${profileUrl}</a> нажми «Login with Telegram», затем снова отправь /start здесь.`,
      );
      return;
    }
    const { ownerUserId, created } = await this.deps.groupOwners.bindIfAbsent(chatId, userId);
    // Привязка нужна ТОЛЬКО чтобы ловить сообщения от участников без аккаунта: у каждого
    // привязанного задачи и так создаются в ЕГО проектах. Владелец группы — «корзина» для
    // непривязанных.
    if (created) {
      await this.reply(
        chatId,
        `✅ Готово. Каждый участник с аккаунтом создаёт задачи в СВОИХ проектах — просто пишет мне текст.\n\n` +
          `Сообщения от участников <b>без аккаунта</b> ProjectsFlow будут падать в твои «Входящие».`,
      );
      return;
    }
    if (ownerUserId === userId) {
      await this.reply(
        chatId,
        'ℹ️ Уже настроено на тебя. Каждый участник с аккаунтом пишет задачи в свои проекты; сообщения без аккаунта — в твои «Входящие».',
      );
      return;
    }
    const owner = await this.deps.users.getById(ownerUserId).catch(() => null);
    const name = owner?.displayName ?? 'другого участника';
    await this.reply(
      chatId,
      `ℹ️ У тебя есть аккаунт — просто пиши мне текст, задачи создаются в ТВОИХ проектах.\n\n` +
        `(Сообщения от участников без аккаунта ловит «Входящие» ${escapeHtml(name)}.)`,
    );
  }

  private async handlePause(tgUserId: number, chatId: number): Promise<void> {
    const userId = await this.deps.users.findUserIdByTelegramUserId(tgUserId);
    if (!userId) {
      await this.reply(chatId, '⚠️ Сначала привяжи Telegram через /profile.');
      return;
    }
    const allOff: TelegramNotificationPrefs = {
      commentOnMyTask: false,
      mention: false,
      statusChange: false,
      ralphQuestion: false,
      ralphAnswer: false,
      taskDone: false,
    };
    await this.deps.users.updateTelegramPrefs(userId, allOff);
    const profileUrl = `${this.deps.appUrl.replace(/\/$/, '')}/profile`;
    await this.reply(
      chatId,
      `⏸️ Уведомления приостановлены. Включить отдельные типы — на <a href="${profileUrl}">${profileUrl}</a>.`,
    );
  }

  private async handlePending(tgUserId: number, chatId: number): Promise<void> {
    const userId = await this.deps.users.findUserIdByTelegramUserId(tgUserId);
    if (!userId) {
      await this.reply(chatId, '⚠️ Сначала привяжи Telegram через /profile.');
      return;
    }
    const projects = await this.deps.members.listProjectsForUser(userId);
    const pending: {
      projectId: string;
      projectName: string;
      taskId: string;
      description: string | null;
    }[] = [];
    for (const p of projects) {
      const list = await this.deps.tasks.listByProject(p.id);
      for (const t of list) {
        if (t.status === 'awaiting_clarification') {
          pending.push({
            projectId: p.id,
            projectName: p.name,
            taskId: t.id,
            description: t.description,
          });
        }
      }
    }
    if (pending.length === 0) {
      await this.reply(chatId, '✨ Нет открытых уточнений.');
      return;
    }
    const base = this.deps.appUrl.replace(/\/$/, '');
    const lines = pending
      .slice(0, 20)
      .map((p) => {
        // ?task= deep-link открывает диалог задачи на board (см. KanbanBoard).
        const url = `${base}/projects/${p.projectId}?task=${p.taskId}`;
        const excerpt = (p.description ?? '').slice(0, 80) || '(без описания)';
        return `• <b>${escapeHtml(p.projectName)}</b>: <a href="${url}">${escapeHtml(excerpt)}</a>`;
      })
      .join('\n');
    await this.reply(
      chatId,
      `🤔 <b>Открытые уточнения (${pending.length}):</b>\n\n${lines}`,
    );
  }

  private async handleHelp(chatId: number): Promise<void> {
    const bot = this.deps.botUsername ? `@${this.deps.botUsername}` : '@бот';
    await this.reply(
      chatId,
      `🤖 <b>ProjectsFlow-бот</b>\n\n` +
        `<b>Создавай задачи прямо отсюда — заходить в проекты не нужно:</b>\n\n` +
        `📥 <b>Во «Входящие»</b> — просто напиши текст:\n` +
        `   <code>Купить домен для лендинга</code>\n\n` +
        `📁 <b>В конкретный проект</b> — добавь <code>+Проект</code> в начало:\n` +
        `   <code>+ScanFlow поправить парсинг чеков</code>\n` +
        `   <i>имя подскажу кнопками, если совпадёт несколько</i>\n\n` +
        `👤 <b>Назначить ответственного</b> — добавь <code>@Имя</code> в конец:\n` +
        `   <code>+DocsFlow обновить шаблон @Олег</code>\n` +
        `   <i>задача сразу появится у коллеги; он сможет выполнить её или сменить ответственного</i>\n\n` +
        `⚡ <b>Из любого чата</b> — набери <code>${bot} текст задачи</code> и выбери проект из списка.\n\n` +
        `💬 <b>Комментарий</b> — ответь (reply) на карточку задачи от бота. Участники получат уведомление.\n\n` +
        `<b>Команды:</b>\n` +
        `/tasks — задачи по ответственным\n` +
        `/pending — задачи «На уточнении»\n` +
        `/pause — выключить уведомления\n` +
        `/start — переподключить бота\n` +
        `/help — эта справка\n\n` +
        `🔗 <i>Telegram привязан ко всему аккаунту сразу — доступны все твои проекты.</i>`,
    );
  }

  // --- Reply на task-сообщение бота → обычный комментарий к задаче (db/049). ---
  private async handleTaskReplyComment(
    tgUserId: number,
    chatId: number,
    replyToMessageId: number,
    text: string,
  ): Promise<void> {
    const map = await this.deps.taskMessages.findByMessage(chatId, replyToMessageId);
    if (!map) {
      await this.reply(
        chatId,
        '↩️ Это сообщение не привязано к задаче. Reply работает на карточки задач, назначения ответственного и уточнения бота.',
      );
      return;
    }
    const senderUserId = await this.deps.users.findUserIdByTelegramUserId(tgUserId);
    if (!senderUserId) {
      await this.reply(chatId, '⚠️ Сначала привяжи Telegram через /profile.');
      return;
    }
    if (text.trim().length === 0) {
      await this.reply(chatId, '✍️ Пустой комментарий.');
      return;
    }

    let comment;
    try {
      comment = await this.deps.createComment.execute({
        projectId: map.projectId,
        ownerUserId: senderUserId,
        taskId: map.taskId,
        body: text,
        actorKind: 'user',
        notifyMode: 'all',
      });
    } catch (err) {
      const name = err instanceof Error ? err.constructor.name : '';
      if (name === 'ProjectNotFoundError') {
        await this.reply(chatId, '🚫 Нет доступа к этой задаче.');
      } else if (name === 'TaskNotFoundError') {
        await this.reply(chatId, '⚠️ Задача удалена.');
      } else if (name === 'TaskCommentBodyEmptyError') {
        await this.reply(chatId, '✍️ Пустой комментарий.');
      } else {
        console.warn('[tg-webhook] createComment (reply) failed:', err);
        await this.reply(chatId, '❌ Не удалось сохранить комментарий.');
      }
      return;
    }

    // SSE: коммент мгновенно у всех участников.
    this.deps.notifyCommentAdded(map.projectId, map.taskId, comment.id, senderUserId, 'user', null);
    // Email + Telegram участникам — как HTTP-роут (tasks/routes.ts). Best-effort.
    void this.deps.dispatchCommentNotifications
      .execute({
        projectId: map.projectId,
        actorUserId: senderUserId,
        source: 'team',
        audience: { mode: 'all' },
        comment: {
          id: comment.id,
          taskId: map.taskId,
          body: text,
          actorKind: 'user',
          agentName: null,
          replyToCommentId: comment.replyToCommentId,
        },
      })
      .catch((e: unknown) => console.warn('[tg-webhook] dispatchCommentNotifications failed:', e));

    await this.reply(chatId, '💬 Комментарий добавлен.');
  }

  // --- /tasks: экран 1 «по ответственным» → карточки задач; «📁 По проектам» (bt:root)
  //     ведёт на старый браузер проект → задачи → карточка. ---
  private async handleTasks(tgUserId: number, chatId: number): Promise<void> {
    const userId = await this.deps.users.findUserIdByTelegramUserId(tgUserId);
    if (!userId) {
      await this.reply(chatId, '⚠️ Сначала привяжи Telegram через /profile.');
      return;
    }
    await this.sendAssigneeMenu(chatId, userId);
  }

  // Меню «по ответственным». ownerUserId — чей охват проектов показываем (в личке —
  // сам вызывающий; в группе — владелец привязки, см. handleGroupAssigneeMenu).
  private async sendAssigneeMenu(chatId: number, ownerUserId: string): Promise<void> {
    const menu = await buildAssigneeMenu(this.assigneeDeps(), ownerUserId);
    if (!menu) {
      await this.reply(chatId, '📭 У тебя пока нет проектов. Напиши текст — создам задачу во «Входящие».');
      return;
    }
    await this.reply(chatId, menu.text, menu.keyboard);
  }

  // Пустое @упоминание в группе: меню по ответственным от имени владельца привязки.
  // Не привязано → подсказка /start (та же привязка, что ловит задачи непривязанных).
  private async handleGroupAssigneeMenu(chatId: number): Promise<void> {
    const ownerUserId = await this.deps.groupOwners.getOwnerUserId(chatId);
    if (!ownerUserId) {
      await this.reply(
        chatId,
        '⚠️ Группа не привязана к аккаунту. Отправь /start, чтобы привязать её к себе, — и вызывай меню задач пустым упоминанием.',
      );
      return;
    }
    await this.sendAssigneeMenu(chatId, ownerUserId);
  }

  // Узкий deps-набор для билдеров assigneeBrowse.
  private assigneeDeps() {
    return {
      members: this.deps.members,
      tasks: this.deps.tasks,
    };
  }

  // Экран «По проектам» (бывший корень /tasks) — вторичная навигация с кнопки bt:root.
  private async sendProjectList(chatId: number, userId: string): Promise<void> {
    const projects = await this.deps.members.listProjectsForUser(userId);
    if (projects.length === 0) {
      await this.reply(chatId, '📭 У тебя пока нет проектов. Напиши текст — создам задачу во «Входящие».');
      return;
    }
    const shown = projects.slice(0, BROWSE_LIMIT);
    const rows = chunk2(
      shown.map((p) => ({ text: p.name.slice(0, 40), callback_data: `bt:p:${p.id}` })),
    );
    const note =
      projects.length > BROWSE_LIMIT
        ? `\n\n<i>Показаны первые ${BROWSE_LIMIT} из ${projects.length} — остальные в интерфейсе.</i>`
        : '';
    await this.reply(chatId, `📂 <b>Выбери проект:</b>${note}`, { inline_keyboard: rows });
  }

  // ba:<userId> — карточки открытых задач выбранного ответственного (экран 2).
  // Охват — проекты НАЖАВШЕГО (гейт членства встроен: listProjectsForUser). Каждая карточка
  // регистрируется в telegram_task_messages → reply на неё = комментарий (handleTaskReplyComment).
  private async handleAssigneeCallback(cq: TelegramCallbackQuery): Promise<void> {
    const chatId = cq.message?.chat.id ?? cq.from.id;
    const userId = await this.deps.users.findUserIdByTelegramUserId(cq.from.id);
    if (!userId) {
      await this.answerNeedsLink(cq.id);
      return;
    }
    const assigneeUserId = (cq.data ?? '').slice('ba:'.length);
    const sent = await this.sendAssigneeCards(chatId, userId, assigneeUserId);
    if (!sent) {
      await this.deps.client.answerCallbackQuery(cq.id, {
        text: 'Открытых задач не нашлось.',
        showAlert: true,
      });
      return;
    }
    await this.deps.client.answerCallbackQuery(cq.id);
  }

  // Отрисовать карточки открытых задач ответственного (заголовок + карточка на задачу).
  // false = задач нет. Каждая карточка регистрируется в telegram_task_messages (reply на неё
  // становится комментарием к задаче). Общий код для кнопки ba:<id> и текстового «@Человек».
  private async sendAssigneeCards(
    chatId: number,
    viewerUserId: string,
    assigneeUserId: string,
  ): Promise<boolean> {
    const result = await buildAssigneeTaskCards(
      this.assigneeDeps(),
      viewerUserId,
      assigneeUserId,
      this.deps.appUrl,
    );
    if (result.cards.length === 0) return false;
    const who = result.assigneeName ?? 'Ответственный';
    const extra =
      result.totalCount > result.cards.length
        ? ` (первые ${result.cards.length} из ${result.totalCount})`
        : '';
    await this.reply(chatId, `👤 <b>${escapeHtml(who)}</b> — открытые задачи${extra}:`);
    for (const card of result.cards) {
      const messageId = await this.sendReturningId(chatId, card.text, card.keyboard);
      if (messageId !== null) {
        try {
          await this.deps.taskMessages.upsert({
            tgChatId: chatId,
            tgMessageId: messageId,
            recipientUserId: viewerUserId,
            taskId: card.taskId,
            projectId: card.projectId,
          });
        } catch (err) {
          console.warn('[tg-webhook] assignee card taskMessage upsert failed:', err);
        }
      }
    }
    return true;
  }

  // Сводка открытых задач ОДНОГО человека — в формате «сводки по ответственным» (одно rich-
  // сообщение, задачи сгруппированы по проектам). false = задач нет. Тот же билдер, что у
  // ежедневной сводки (buildWorkspaceAssigneeDigest*), чтобы вид был единый.
  private async sendAssigneeDigest(
    chatId: number,
    viewerUserId: string,
    assigneeUserId: string,
  ): Promise<boolean> {
    const { displayName, projects } = await collectAssigneeProjectTasks(
      this.assigneeDeps(),
      viewerUserId,
      assigneeUserId,
    );
    if (projects.length === 0) return false;

    // Ссылка нужна билдеру только для @mention в заголовке. Если привязки TG нет (нашёлся по
    // имени) — синтетическая заглушка: имя покажется как есть.
    const link =
      (await this.deps.users.getTelegramLink(assigneeUserId).catch(() => null)) ?? {
        telegramUserId: 0,
        telegramUsername: null,
        telegramFirstName: null,
        telegramPhotoUrl: null,
        telegramAuthDate: null,
        tgChatId: null,
        tgStartedAt: null,
        tgPairedAt: null,
        prefs: null,
      };
    const name = displayName ?? 'Участник';
    const richHtml = buildWorkspaceAssigneeDigestRichMessage({
      displayName: name,
      telegramLink: link,
      projects,
      appUrl: this.deps.appUrl,
    });
    const fallbackHtml = buildWorkspaceAssigneeDigestMessage({
      displayName: name,
      telegramLink: link,
      projects,
      appUrl: this.deps.appUrl,
    });

    let ok = false;
    let allowFallback = !this.deps.client.sendRichMessage;
    if (this.deps.client.sendRichMessage) {
      try {
        const res = await this.deps.client.sendRichMessage({ chatId, html: richHtml });
        if (res.kind === 'ok') ok = true;
        else allowFallback = res.kind === 'error' && res.deliveryUnknown !== true;
      } catch (err) {
        console.warn('[tg-webhook] assignee digest rich failed:', err);
        allowFallback = false;
      }
    }
    if (!ok && allowFallback) {
      const res = await this.deps.client
        .sendMessage({ chatId, text: fallbackHtml, parseMode: 'HTML', disableWebPagePreview: true })
        .catch(() => null);
      ok = res?.kind === 'ok';
    }
    return ok;
  }

  // «@Bot @Человек» (в группе) / «@Человек» (в личке) без текста задачи → открытые задачи
  // этого человека по проектам (сводка «что осталось»). Резолв имени — среди тех, у кого есть
  // открытые задачи (fuzzyMatch по displayName); неоднозначность → кнопки выбора; нет — подсказка.
  private async handleAssigneeTasksRequest(
    chatId: number,
    tgUserId: number,
    isGroup: boolean,
    assigneeQuery: string,
  ): Promise<void> {
    const ownerUserId = isGroup
      ? await this.deps.groupOwners.getOwnerUserId(chatId)
      : await this.deps.users.findUserIdByTelegramUserId(tgUserId);
    if (!ownerUserId) {
      await this.reply(
        chatId,
        isGroup
          ? '⚠️ Группа не привязана к аккаунту. Отправь /start, чтобы привязать её к себе.'
          : '⚠️ Сначала привяжи Telegram через /profile.',
      );
      return;
    }

    // Случайно просочившееся упоминание САМОГО бота (@Bot) — не «человек», показываем меню.
    const bu = this.deps.botUsername;
    if (bu && assigneeQuery.toLowerCase() === bu.toLowerCase()) {
      return this.sendAssigneeMenu(chatId, ownerUserId);
    }

    // 1) Резолв по Telegram @username — в TG людей упоминают именно так (@hotspotping), а не
    //    по отображаемому имени. Нашли пользователя → сразу его карточки.
    if (assigneeQuery.length > 0) {
      const byUsername = await this.deps.users.findUserIdByTelegramUsername(assigneeQuery);
      if (byUsername) {
        const sent = await this.sendAssigneeDigest(chatId, ownerUserId, byUsername);
        if (!sent) {
          await this.reply(chatId, `✨ У @${escapeHtml(assigneeQuery)} нет открытых задач в проектах.`);
        }
        return;
      }
    }

    // 2) Фоллбэк: по отображаемому имени среди тех, у кого есть открытые задачи.
    const res = await resolveAssigneeByName(this.assigneeDeps(), ownerUserId, assigneeQuery);
    if (res.kind === 'no_projects') {
      await this.reply(chatId, '📭 Пока нет проектов с открытыми задачами.');
      return;
    }
    if (res.kind === 'none') {
      await this.reply(
        chatId,
        `🤷 Не нашёл «${escapeHtml(assigneeQuery)}» среди тех, у кого есть открытые задачи. Проверь имя или открой меню: /tasks`,
      );
      return;
    }
    if (res.kind === 'ambiguous') {
      const rows = chunk2(
        res.options.map((o) => ({
          text: `👤 ${o.name.slice(0, 32)} (${o.count})`,
          callback_data: `ba:${o.userId}`,
        })),
      );
      await this.reply(chatId, '🔎 Уточни, кто именно:', { inline_keyboard: rows });
      return;
    }
    const sent = await this.sendAssigneeDigest(chatId, ownerUserId, res.assigneeUserId);
    if (!sent) {
      await this.reply(chatId, `✨ У «${escapeHtml(res.assigneeName)}» нет открытых задач.`);
    }
  }

  private async handleBrowseCallback(cq: TelegramCallbackQuery): Promise<void> {
    const data = cq.data ?? '';
    // В личном чате chat.id === from.id. Для «старых» сообщений (>48ч) Telegram НЕ
    // присылает cq.message — берём chat из from.id, иначе кнопки старого /tasks ложно
    // ругались бы «Привяжи Telegram», хотя аккаунт привязан. См.
    // core.telegram.org/bots/api#callbackquery («message ... not available if too old»).
    const chatId = cq.message?.chat.id ?? cq.from.id;
    const userId = await this.deps.users.findUserIdByTelegramUserId(cq.from.id);
    if (!userId) {
      await this.deps.client.answerCallbackQuery(cq.id, {
        text: 'Сначала привяжи Telegram: в профиле на сайте нажми «Login with Telegram», затем отправь /start.',
        showAlert: true,
      });
      return;
    }
    // bt:root — экран «По проектам» из меню по ответственным.
    if (data === 'bt:root') {
      await this.sendProjectList(chatId, userId);
      await this.deps.client.answerCallbackQuery(cq.id);
      return;
    }
    // bt:p:<projectId> | bt:t:<taskId>
    const body = data.slice('bt:'.length);
    const kind = body.slice(0, 2);
    const arg = body.slice(2);

    if (kind === 'p:') {
      const projectId = arg;
      const membership = await this.deps.members.findForProject(projectId, userId);
      if (!membership) {
        await this.deps.client.answerCallbackQuery(cq.id, { text: 'Нет доступа к проекту.', showAlert: true });
        return;
      }
      const tasks = (await this.deps.tasks.listByProject(projectId)).filter(
        (t) => t.status !== 'done',
      );
      if (tasks.length === 0) {
        await this.reply(chatId, '✨ В этом проекте нет открытых задач.');
        await this.deps.client.answerCallbackQuery(cq.id);
        return;
      }
      const shown = tasks.slice(0, BROWSE_LIMIT);
      const rows = shown.map((t) => {
        // Есть картинки в описании → префикс 🖼 (в кнопке видно, что внутри фото).
        const hasImg = extractImageSrcs(t.description).length > 0;
        // Лейбл — plain-НАЗВАНИЕ (первая непустая строка без markdown), не обрывок описания.
        const cap = hasImg ? 52 : 56;
        const title = splitDescription(t.description).name;
        const clipped = title.length <= cap ? title : title.slice(0, cap - 1).trimEnd() + '…';
        return [{ text: `${hasImg ? '🖼 ' : ''}${clipped}`, callback_data: `bt:t:${t.id}` }];
      });
      const note =
        tasks.length > BROWSE_LIMIT
          ? `\n\n<i>Показаны первые ${BROWSE_LIMIT} из ${tasks.length}.</i>`
          : '';
      await this.reply(chatId, `📋 <b>Задачи:</b> (нажми, чтобы открыть)${note}`, {
        inline_keyboard: rows,
      });
      await this.deps.client.answerCallbackQuery(cq.id);
      return;
    }

    if (kind === 't:') {
      const taskId = arg;
      const task = await this.deps.tasks.getById(taskId);
      if (!task) {
        await this.deps.client.answerCallbackQuery(cq.id, { text: 'Задача удалена.', showAlert: true });
        return;
      }
      const membership = await this.deps.members.findForProject(task.projectId, userId);
      if (!membership) {
        await this.deps.client.answerCallbackQuery(cq.id, { text: 'Нет доступа к задаче.', showAlert: true });
        return;
      }
      await this.deps.client.answerCallbackQuery(cq.id);
      const base = this.deps.appUrl.replace(/\/$/, '');
      const url = `${base}/projects/${task.projectId}?task=${task.id}`;
      const taskAttachments = await this.deps.attachments.listByTask(task.id).catch((err) => {
        console.warn('[tg-webhook] list task attachments failed:', err);
        return [];
      });
      const attachmentsById = new Map(
        taskAttachments.map((attachment) => [attachment.id, attachment]),
      );
      const attachmentData = new Map<string, Buffer | null>();
      const readAttachment = async (attachmentId: string): Promise<Buffer | undefined> => {
        if (attachmentData.has(attachmentId)) {
          return attachmentData.get(attachmentId) ?? undefined;
        }
        const attachment = attachmentsById.get(attachmentId);
        if (!attachment) return undefined;
        const stored = await this.deps.attachmentStorage.read(attachment.storageKey).catch((err) => {
          console.warn('[tg-webhook] read task attachment failed:', err);
          return null;
        });
        const data = stored?.data ?? null;
        attachmentData.set(attachmentId, data);
        return data ?? undefined;
      };
      const now = Date.now();
      const content = buildTaskTelegramContent(task.description, taskAttachments, (attachmentId) =>
        signAttachmentUrl(
          base,
          `/api/attachments/${attachmentId}`,
          this.deps.signingSecret,
          TG_ATTACHMENT_URL_TTL_SECONDS,
          now,
        ),
      );
      const registerMessage = async (messageId: number | null): Promise<void> => {
        if (messageId === null) return;
        try {
          await this.deps.taskMessages.upsert({
            tgChatId: chatId,
            tgMessageId: messageId,
            recipientUserId: userId,
            taskId: task.id,
            projectId: task.projectId,
          });
        } catch (err) {
          console.warn('[tg-webhook] task content message upsert failed:', err);
        }
      };

      const richFooter =
        `<footer><a href="${escapeHtml(url)}">Открыть в ProjectsFlow</a><br/>` +
        `↩️ Ответь reply'ем на это сообщение, чтобы добавить комментарий.</footer>`;
      // One task must remain one Telegram message. Bot API 10.2 can embed photos, videos,
      // animations and audio directly in this rich card. General documents aren't accepted as
      // rich media, so the content builder keeps their signed download links in the same card.
      const richContent = buildTaskTelegramRichContent(content, richFooter);
      if (richContent && this.deps.client.sendRichMessage) {
        const richMedia: SendRichMessageMediaInput[] = [];
        // Read sequentially: even within the aggregate upload budget, dozens of concurrent disk
        // reads and Buffer copies create avoidable heap spikes under parallel Telegram requests.
        for (const media of richContent.media) {
          richMedia.push({
            ...media,
            data: await readAttachment(media.attachmentId),
          });
        }
        const result = await this.deps.client
          .sendRichMessage({
            chatId,
            html: richContent.html,
            media: richMedia,
          })
          .catch((err) => {
            console.warn('[tg-webhook] send task rich content failed:', err);
            return null;
          });
        if (result?.kind === 'ok') {
          await registerMessage(result.messageId);
          return;
        } else if (result) {
          const detail = result.kind === 'rate_limited'
            ? `retry_after=${result.retryAfter}`
            : result.description;
          console.warn(
            `[tg-webhook] task rich content rejected: kind=${result.kind}; ${detail}; ` +
              `media_count=${richContent.media.length}`,
          );
          // A forbidden/rate-limited delivery can't be fixed by another immediate send. A
          // transport failure may have reached Telegram despite the lost response, so sending a
          // fallback would risk duplicating the task.
          if (
            result.kind === 'forbidden' ||
            result.kind === 'rate_limited' ||
            (result.kind === 'error' && result.deliveryUnknown)
          ) {
            return;
          }
        } else {
          return;
        }
      }

      // Compatibility fallback preserves the one-task/one-message contract too.
      const fallbackMessageId = await this.sendReturningId(
        chatId,
        buildTaskTelegramFallbackContent(content, url),
      );
      await registerMessage(fallbackMessageId);
      return;
    }

    await this.deps.client.answerCallbackQuery(cq.id);
  }

  // Inline-режим (Phase D): живой dropdown проектов и ответственных.
  private async handleInlineQuery(
    inlineQueryId: string,
    tgUserId: number,
    query: string,
  ): Promise<void> {
    await this.deps.composer.handleInlineQuery(inlineQueryId, tgUserId, query);
  }

  private async reply(
    chatId: number,
    text: string,
    replyMarkup?: InlineKeyboardMarkup,
  ): Promise<void> {
    try {
      await this.deps.client.sendMessage({
        chatId,
        text,
        parseMode: 'HTML',
        disableWebPagePreview: true,
        replyMarkup,
      });
    } catch (err) {
      console.warn('[tg-webhook] reply failed', err);
    }
  }

  // Как reply, но возвращает message_id (для маппинга task-сообщения). null при ошибке.
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
      console.warn('[tg-webhook] sendReturningId failed', err);
      return null;
    }
  }
}

// Максимум кнопок проектов/задач в /tasks (без пагинации в v1 — остальное в вебе).
const BROWSE_LIMIT = 12;

// Разбивка списка кнопок по 2 в ряд.
function chunk2<T>(items: readonly T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += 2) {
    rows.push(items.slice(i, i + 2));
  }
  return rows;
}

// Чистый однострочный excerpt: снимаем markdown-разметку (#, **, `, -, [ссылки], картинки),
// схлопываем пробелы и обрезаем. Кнопки/детали Telegram показывают текст, а не разметку.
function excerptShort(text: string | null, limit: number): string {
  const s = stripAllMarkdown(text).replace(/\s+/g, ' ').trim();
  if (s.length === 0) return '(без описания)';
  return s.length <= limit ? s : s.slice(0, limit - 1).trimEnd() + '…';
}

// Человекочитаемое имя отправителя для атрибуции задачи-фолбэка: «Имя Фамилия (@username)».
function formatSenderName(from: {
  readonly first_name?: string;
  readonly last_name?: string;
  readonly username?: string;
}): string {
  const full = [from.first_name, from.last_name]
    .filter((s): s is string => !!s && s.trim().length > 0)
    .join(' ')
    .trim();
  if (full && from.username) return `${full} (@${from.username})`;
  if (full) return full;
  if (from.username) return `@${from.username}`;
  return 'участник';
}

function excerptVoiceTranscript(text: string, limit: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 38).trimEnd()}…\n\n(Полный текст учтён в новой задаче)`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
