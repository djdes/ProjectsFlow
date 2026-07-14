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
  readonly taskText: string | null;
  readonly projectId: string | null;
  readonly assigneeUserId: string | null;
  readonly offered: TelegramDraftOffered | null;
  readonly segments: TelegramDraftSegment[] | null;
  readonly photos: TelegramDraftPhoto[];
  // Колонка канбана для РУЧНОГО флоу (одиночная задача). null = дефолт 'backlog'.
  // Для AI-флоу колонка хранится per-segment в segments[].targetStatus. См. db/068.
  readonly targetStatus: VisibleKanbanStatus | null;
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
  readonly taskText: string | null;
  readonly projectId?: string | null;
  readonly assigneeUserId?: string | null;
  readonly offered?: TelegramDraftOffered | null;
  readonly segments?: TelegramDraftSegment[] | null;
  readonly photos?: readonly TelegramDraftPhoto[];
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
  readonly tgMessageId?: number | null;
  readonly targetStatus?: VisibleKanbanStatus | null;
  readonly status?: TelegramTaskDraftStatus;
};

export interface TelegramTaskDraftRepository {
  create(input: CreateTelegramTaskDraftInput): Promise<TelegramTaskDraft>;
  // NULL если черновик не найден ИЛИ истёк (expires_at < now). Истёкшие не удаляем здесь —
  // это делает deleteExpired (фоновая чистка), но трактуем как отсутствующие.
  getById(id: string): Promise<TelegramTaskDraft | null>;
  patch(id: string, patch: TelegramTaskDraftPatch): Promise<TelegramTaskDraft | null>;
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
