// Порт к Telegram Bot API. Реальная реализация — HttpTelegramClient (fetch);
// в тестах подменяется фейком. Не возвращает «весь» Telegram-ответ — только то, что
// нам нужно (message_id для аудита, тип ошибки для дедупа/блока).

// Inline-кнопка под сообщением. callback_data ≤ 64 байта (TG-лимит) — для конструктора
// носим короткий draft id + индекс. switch_inline_query_current_chat — для Phase D
// (открыть inline-режим прямо в чате бота). См. https://core.telegram.org/bots/api#inlinekeyboardbutton
export type InlineKeyboardButton = {
  readonly text: string;
  readonly callback_data?: string;
  readonly url?: string;
  readonly switch_inline_query_current_chat?: string;
};

export type InlineKeyboardMarkup = {
  readonly inline_keyboard: ReadonlyArray<ReadonlyArray<InlineKeyboardButton>>;
};

// Команда для меню бота (setMyCommands). command — без слэша, lowercase, ≤32 символа;
// description ≤256. См. https://core.telegram.org/bots/api#botcommand
export type TelegramBotCommand = {
  readonly command: string;
  readonly description: string;
};

export type SendMessageInput = {
  readonly chatId: number;
  readonly text: string;
  readonly parseMode?: 'HTML' | 'MarkdownV2';
  readonly disableWebPagePreview?: boolean;
  // Произвольный inline_keyboard / reply_keyboard. Структура — как в TG Bot API.
  readonly replyMarkup?: unknown;
};

export type EditMessageTextInput = {
  readonly chatId: number;
  readonly messageId: number;
  readonly text: string;
  readonly parseMode?: 'HTML' | 'MarkdownV2';
  readonly disableWebPagePreview?: boolean;
  // null/undefined — убрать кнопки; объект — заменить.
  readonly replyMarkup?: unknown;
};

// Минимальный inline-результат (article) для Phase D. input_message_text отправляется
// в чат при выборе — мы делаем его каноническим `+<Проект> <текст> @<Делегат>`, который
// затем проходит через тот же конструктор.
export type InlineQueryResultArticle = {
  readonly type: 'article';
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly input_message_content: {
    readonly message_text: string;
    readonly parse_mode?: 'HTML' | 'MarkdownV2';
  };
};

export type AnswerInlineQueryInput = {
  readonly inlineQueryId: string;
  readonly results: readonly InlineQueryResultArticle[];
  // 0 — не кэшировать (результаты персональны и быстро устаревают).
  readonly cacheTime?: number;
  readonly isPersonal?: boolean;
  // Кнопка «открыть личку с ботом» — ведём на /start если юзер не привязан.
  readonly switchPmText?: string;
  readonly switchPmParameter?: string;
};

export type SendMessageOk = {
  readonly kind: 'ok';
  readonly messageId: number;
};

// 403 «Forbidden: bot was blocked by the user» / «user is deactivated» / «user not started bot»
// — НЕ retry-able. Помечаем юзера: tg_started_at = NULL.
export type SendMessageForbidden = {
  readonly kind: 'forbidden';
  readonly description: string;
};

// 429 — TG-rate-limit. retryAfter секунд (из parameters.retry_after).
export type SendMessageRateLimited = {
  readonly kind: 'rate_limited';
  readonly retryAfter: number;
};

// Прочие ошибки (network, 5xx, неожиданный 400).
export type SendMessageError = {
  readonly kind: 'error';
  readonly description: string;
};

export type SendMessageResult =
  | SendMessageOk
  | SendMessageForbidden
  | SendMessageRateLimited
  | SendMessageError;

// Минимальный slice ответа getChat — нам нужны только id/тип/название группы для
// резолва имени Telegram-группы в окне автоматизации. См. https://core.telegram.org/bots/api#getchat
export type TelegramChatInfo = {
  readonly id: number;
  // title есть у групп/супергрупп/каналов; у привата — нет (тогда null).
  readonly title: string | null;
  readonly type: string; // 'group' | 'supergroup' | 'channel' | 'private'
};

// Минимальный slice Telegram Update — то что polling/webhook читают. Совпадает с
// типом в HandleTelegramWebhook (см. там полное описание). Тут — для возврата getUpdates.
// callback_query (нажатия inline-кнопок) и inline_query (Phase D) парсятся в handler'е.
export type TelegramUpdate = {
  readonly update_id: number;
  readonly message?: unknown;
  readonly callback_query?: unknown;
  readonly inline_query?: unknown;
};

export interface TelegramClient {
  // Возвращает дискриминированный результат — caller сам решает что логировать/повторять.
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
  // Редактирование ранее отправленного сообщения (текст + inline-кнопки). Best-effort —
  // используется конструктором чтобы превратить карточку в «✅ Создано» и убрать кнопки.
  editMessageText(input: EditMessageTextInput): Promise<void>;
  // Ответ на callback_query — гасит «часики» на кнопке. Вызывать в течение ~15с.
  // text (опц.) — тост/алерт пользователю. Best-effort.
  answerCallbackQuery(
    callbackQueryId: string,
    opts?: { text?: string; showAlert?: boolean },
  ): Promise<void>;
  // Ответ на inline_query (Phase D). Best-effort.
  answerInlineQuery(input: AnswerInlineQueryInput): Promise<void>;
  // Регистрация webhook'а на старте сервера. Идемпотентно — TG перезаписывает.
  // secret_token валидируется в webhook handler через X-Telegram-Bot-Api-Secret-Token.
  setWebhook(url: string, secretToken: string): Promise<void>;
  // Меню команд бота (кнопка «/» и Menu в TG-клиенте). Идемпотентно. Best-effort.
  setMyCommands(commands: readonly TelegramBotCommand[]): Promise<void>;
  // Сброс webhook'а — для polling-mode (Telegram не даёт одновременно webhook+getUpdates,
  // иначе getUpdates вернёт 409 Conflict).
  deleteWebhook(): Promise<void>;
  // Long-polling getUpdates: блокируется до timeout (сек) или прихода апдейтов.
  // offset = последний update_id + 1 (server-side ack того что прочитали).
  // Используется когда webhook недоступен (inbound к нам заблокирован хостингом).
  getUpdates(offset: number, timeoutSeconds: number): Promise<TelegramUpdate[]>;
  // Метаданные чата (getChat) — для резолва названия Telegram-группы. Опционально:
  // тестовые фейки могут не реализовывать. null — бот не в чате / нет прав / ошибка
  // (мягкий фоллбэк, не кидаем — резолв имени не должен ронять сохранение настроек).
  getChat?(chatId: number): Promise<TelegramChatInfo | null>;
  // Отправить картинки в чат: 1 → sendPhoto, 2..10 → sendMediaGroup (альбом), >10 → чанки.
  // photoUrls — публично доступные (подписанные) ссылки; Telegram сам их выкачивает.
  // Best-effort (картинки — дополнение к тексту). Опционально: тестовые фейки могут не иметь.
  sendPhotos?(chatId: number, photoUrls: readonly string[]): Promise<void>;
}

// Набор update-типов, которые мы реально обрабатываем. Используется в allowed_updates
// при setWebhook/getUpdates — снижает шум и включает доставку нажатий кнопок и inline.
export const TELEGRAM_ALLOWED_UPDATES = [
  'message',
  'callback_query',
  'inline_query',
] as const;
