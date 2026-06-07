// Серверный стейт многошагового конструктора задач в Telegram-боте. callback_data в
// кнопках ограничен 64 байтами, поэтому в кнопках носим только короткий draft id + индексы,
// а полный контекст (текст, выбранный проект/делегат, предложенные варианты) — здесь.
// См. db/048. Заполняется TelegramComposerService, читается им же при callback'ах.

export type TelegramTaskDraftStatus = 'composing' | 'confirmed' | 'cancelled' | 'expired';

// Предложенные варианты в карточке конструктора: index в callback_data → id здесь.
// offered.projects[idx] / offered.members[idx] резолвят кнопку в UUID без раздувания
// callback_data (UUID = 36 символов, не влезает рядом с draft id в 64 байта).
export type TelegramDraftOffered = {
  readonly projects?: readonly { readonly id: string; readonly name: string }[];
  readonly members?: readonly { readonly id: string; readonly displayName: string }[];
};

// Один AI-распознанный сегмент-задача (mode='compose', простой/быстрый вариант: pass-1 sonnet).
// Сообщение боту прогоняется через AI, который режет его на сегменты и проставляет проект/
// исполнителя/дедлайн. Массив хранится в JSON-колонке segments черновика между показом
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
};

export type TelegramTaskDraft = {
  readonly id: string;
  readonly creatorUserId: string;
  readonly tgChatId: number;
  readonly taskText: string | null;
  readonly projectId: string | null;
  readonly delegateUserId: string | null;
  readonly delegationId: string | null;
  readonly offered: TelegramDraftOffered | null;
  readonly segments: TelegramDraftSegment[] | null;
  readonly status: TelegramTaskDraftStatus;
  readonly createdAt: Date;
  readonly expiresAt: Date;
};

export type CreateTelegramTaskDraftInput = {
  readonly id: string;
  readonly creatorUserId: string;
  readonly tgChatId: number;
  readonly taskText: string | null;
  readonly projectId?: string | null;
  readonly delegateUserId?: string | null;
  readonly offered?: TelegramDraftOffered | null;
  readonly segments?: TelegramDraftSegment[] | null;
  // Срок жизни в секундах от now. Репо считает expires_at = now + ttl.
  readonly ttlSeconds: number;
};

// Patch: undefined = не менять. null допустим для очистки nullable-полей.
export type TelegramTaskDraftPatch = {
  readonly taskText?: string | null;
  readonly projectId?: string | null;
  readonly delegateUserId?: string | null;
  readonly delegationId?: string | null;
  readonly offered?: TelegramDraftOffered | null;
  readonly segments?: TelegramDraftSegment[] | null;
  readonly status?: TelegramTaskDraftStatus;
  // Если задано — продлевает expires_at = now + extendTtlSeconds. Нужно для confirmed-
  // черновиков делегирования: accept может прийти спустя часы (намного позже 30-мин TTL
  // composing-черновика), а нам нужен intended project_id для переноса на accept.
  readonly extendTtlSeconds?: number;
};

export interface TelegramTaskDraftRepository {
  create(input: CreateTelegramTaskDraftInput): Promise<TelegramTaskDraft>;
  // NULL если черновик не найден ИЛИ истёк (expires_at < now). Истёкшие не удаляем здесь —
  // это делает deleteExpired (фоновая чистка), но трактуем как отсутствующие.
  getById(id: string): Promise<TelegramTaskDraft | null>;
  // Найти confirmed-черновик по delegation_id (для переноса задачи в проект на accept).
  // НЕ фильтрует по expires_at — confirmed-черновики живут долго (см. extendTtlSeconds).
  getByDelegationId(delegationId: string): Promise<TelegramTaskDraft | null>;
  patch(id: string, patch: TelegramTaskDraftPatch): Promise<TelegramTaskDraft | null>;
  // Удалить истёкшие черновики. Возвращает число удалённых.
  deleteExpired(): Promise<number>;
}
