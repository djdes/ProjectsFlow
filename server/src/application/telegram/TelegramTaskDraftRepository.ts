// Серверный стейт многошагового конструктора задач в Telegram-боте. callback_data в
// кнопках ограничен 64 байтами, поэтому в кнопках носим только короткий draft id + индексы,
// а полный контекст (текст, выбранный проект/ответственный, предложенные варианты) — здесь.
// См. db/048. Заполняется TelegramComposerService, читается им же при callback'ах.

import type { VisibleKanbanStatus } from '../../domain/kanban/KanbanSettings.js';

// Лайфцикл-статус черновика конструктора (НЕ путать с targetStatus = колонка канбана задачи).
export type TelegramTaskDraftStatus =
  | 'composing'
  | 'confirming'
  | 'confirmed'
  | 'cancelled'
  | 'expired';

// Telegram присылает несколько размеров одной фотографии. В черновике сохраняем только
// самый большой file_id; сам бинарник скачивается непосредственно перед созданием задачи.
export type TelegramDraftPhoto = {
  readonly fileId: string;
  readonly fileUniqueId: string | null;
  readonly width: number;
  readonly height: number;
  readonly fileSize: number | null;
};

// Generalized incoming Telegram media kept in a draft until the user confirms task creation.
// Only Telegram identifiers and metadata are persisted here; binaries are downloaded immediately
// before UploadTaskAttachment runs. targetSegmentIndexes implements a many-to-many file-to-task
// assignment for AI-composed messages containing several task segments.
export type TelegramDraftAttachmentKind =
  | 'photo'
  | 'document'
  | 'video'
  | 'audio'
  | 'voice'
  | 'animation'
  | 'video_note';

export type TelegramDraftAttachment = {
  // Stable inside one draft. Telegram identifiers are intentionally not put into callback_data;
  // the composer addresses attachments by their array index to stay below Telegram's 64-byte cap.
  readonly key: string;
  readonly kind: TelegramDraftAttachmentKind;
  readonly fileId: string;
  readonly fileUniqueId: string | null;
  readonly filename: string;
  readonly mimeType: string;
  readonly fileSize: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly duration: number | null;
  readonly targetSegmentIndexes: readonly number[];
};

// Предложенные варианты в карточке конструктора: index в callback_data → id здесь.
// offered.projects[idx] / offered.members[idx] резолвят кнопку в UUID без раздувания
// callback_data (UUID = 36 символов, не влезает рядом с draft id в 64 байта).
export type TelegramDraftOffered = {
  readonly projects?: readonly { readonly id: string; readonly name: string }[];
  readonly members?: readonly { readonly id: string; readonly displayName: string }[];
};

// Один AI-распознанный сегмент-задача (mode='compose', простой/быстрый вариант: pass-1 sonnet).
// Сообщение боту прогоняется через AI, который режет его на сегменты и проставляет проект/
// ответственного/дедлайн. Массив хранится в JSON-колонке segments черновика между показом
// карточки и нажатием «Создать». index в массиве = `seg` в callback_data (ap/ad/al/at/ae).
// null segments = старый ручной флоу (без AI). См. db/067.
export type TelegramDraftSegment = {
  readonly title: string;
  // simpleBody: причёсанный markdown (списки/жирный), без заголовков верхнего уровня.
  readonly body: string;
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly assigneeUserId: string | null;
  // Сырое имя из текста («Олег») — подсказка, когда userId не сматчился.
  readonly assigneeName: string | null;
  readonly deadline: string | null; // YYYY-MM-DD
  // Тогл «включить в создание» (правка в многосегментной карточке). default true.
  readonly included: boolean;
  // Колонка канбана (статус) задачи. null = дефолт 'backlog' (ЧЕРНОВИКИ) при создании.
  // Хранится канонический ключ статуса (backlog/manual/todo/done); имя колонки резолвится
  // под проект сегмента при рендере. См. db/067 (поле внутри JSON segments).
  readonly targetStatus: VisibleKanbanStatus | null;
};

export type TelegramTaskDraft = {
  readonly id: string;
  readonly creatorUserId: string;
  readonly tgChatId: number;
  readonly tgMessageId: number | null;
  // Globally unique normalized Telegram source, for example a chat/message or chat/media-group
  // tuple. null is retained for legacy drafts created before inbound idempotency was introduced.
  readonly sourceKey: string | null;
  readonly taskText: string | null;
  readonly projectId: string | null;
  readonly assigneeUserId: string | null;
  readonly offered: TelegramDraftOffered | null;
  readonly segments: TelegramDraftSegment[] | null;
  readonly photos: TelegramDraftPhoto[];
  readonly attachments: TelegramDraftAttachment[];
  // Колонка канбана для РУЧНОГО флоу (одиночная задача). null = дефолт 'backlog'.
  // Для AI-флоу колонка хранится per-segment в segments[].targetStatus. См. db/068.
  readonly targetStatus: VisibleKanbanStatus | null;
  // Правка формулировки: индекс сегмента, который ждёт новый текст от пользователя.
  // null — ничего не ждём; MANUAL_TEXT_SEG (-1) — ручной черновик без сегментов. См. db/140.
  readonly awaitingTextSeg: number | null;
  readonly status: TelegramTaskDraftStatus;
  readonly createdAt: Date;
  readonly autoCreateAt: Date | null;
  readonly confirmationStartedAt: Date | null;
  readonly expiresAt: Date;
};

export type CreateTelegramTaskDraftInput = {
  readonly id: string;
  readonly creatorUserId: string;
  readonly tgChatId: number;
  readonly tgMessageId?: number | null;
  readonly sourceKey?: string | null;
  readonly taskText: string | null;
  readonly projectId?: string | null;
  readonly assigneeUserId?: string | null;
  readonly offered?: TelegramDraftOffered | null;
  readonly segments?: TelegramDraftSegment[] | null;
  readonly photos?: readonly TelegramDraftPhoto[];
  readonly attachments?: readonly TelegramDraftAttachment[];
  readonly targetStatus?: VisibleKanbanStatus | null;
  // Срок жизни в секундах от now. Репо считает expires_at = now + ttl.
  readonly ttlSeconds: number;
  // Через сколько секунд автоматически подтвердить черновик. null/undefined = не создавать.
  readonly autoCreateSeconds?: number | null;
};

// Patch: undefined = не менять. null допустим для очистки nullable-полей.
export type TelegramTaskDraftPatch = {
  readonly taskText?: string | null;
  readonly projectId?: string | null;
  readonly assigneeUserId?: string | null;
  readonly offered?: TelegramDraftOffered | null;
  readonly segments?: TelegramDraftSegment[] | null;
  readonly photos?: readonly TelegramDraftPhoto[];
  readonly attachments?: readonly TelegramDraftAttachment[];
  readonly tgMessageId?: number | null;
  readonly sourceKey?: string | null;
  readonly targetStatus?: VisibleKanbanStatus | null;
  readonly status?: TelegramTaskDraftStatus;
  readonly awaitingTextSeg?: number | null;
};

// Ручной черновик (без AI-сегментов) — текст один, индексировать нечего. Отдельное значение,
// а не 0: нулевой индекс — это первый сегмент AI-карточки, их нельзя путать.
export const MANUAL_TEXT_SEG = -1;

export interface TelegramTaskDraftRepository {
  create(input: CreateTelegramTaskDraftInput): Promise<TelegramTaskDraft>;
  // Черновик этого автора в этом чате, ожидающий новый текст (awaiting_text_seg IS NOT NULL).
  // Ограничен автором и чатом: карточка живёт в общем чате, и сосед не должен переписать
  // чужую задачу своим ответом. null — никто ничего не ждёт, сообщение обрабатывается обычно.
  findAwaitingText(creatorUserId: string, tgChatId: number): Promise<TelegramTaskDraft | null>;
  // NULL если черновик не найден ИЛИ истёк (expires_at < now). Истёкшие не удаляем здесь —
  // это делает deleteExpired (фоновая чистка), но трактуем как отсутствующие.
  getById(id: string): Promise<TelegramTaskDraft | null>;
  // Reads regardless of expiry/status. A repeated Telegram update must stay idempotent while its
  // draft row exists, including after that draft has already been confirmed or cancelled.
  findBySourceKey(sourceKey: string): Promise<TelegramTaskDraft | null>;
  patch(id: string, patch: TelegramTaskDraftPatch): Promise<TelegramTaskDraft | null>;
  // Atomic guard for AI enrichment: auto-create/cancel may change the lifecycle status while
  // the model is running, so a stale result must never overwrite a processed draft/card.
  patchComposing(id: string, patch: TelegramTaskDraftPatch): Promise<TelegramTaskDraft | null>;
  listDueForAutoCreate(limit: number): Promise<TelegramTaskDraft[]>;
  // Атомарный composing→confirming. dueOnly защищает фоновый тик от раннего запуска.
  claimForConfirmation(id: string, dueOnly: boolean): Promise<TelegramTaskDraft | null>;
  // При временной ошибке возвращаем черновик в очередь; при ручной отмене меняем только composing.
  releaseConfirmation(id: string, retrySeconds: number): Promise<void>;
  cancelComposing(id: string): Promise<boolean>;
  recoverStaleConfirmations(staleSeconds: number, retrySeconds: number): Promise<number>;
  // Удалить истёкшие черновики. Возвращает число удалённых.
  deleteExpired(): Promise<number>;
}
