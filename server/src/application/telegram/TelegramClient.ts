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

// Bot API 10.2 rich message. Declared media can be referenced from the HTML with
// tg://photo, tg://video, or tg://audio links and rendered between text blocks.
export type SendRichMessageInput = {
  readonly chatId: number;
  readonly html: string;
  readonly media?: readonly SendRichMessageMediaInput[];
  readonly replyMarkup?: unknown;
};

export type DeleteMessagesInput = {
  readonly chatId: number;
  // Bot API принимает от 1 до 100 идентификаторов за запрос.
  readonly messageIds: readonly number[];
};

export type SendRichMessageMediaInput = {
  readonly id: string;
  readonly kind: 'photo' | 'video' | 'audio' | 'animation' | 'voice_note';
  readonly url: string;
  readonly data?: Buffer;
  readonly filename?: string;
  readonly mimeType?: string;
};

export type SendAttachmentInput = {
  readonly chatId: number;
  readonly url?: string;
  readonly data?: Buffer;
  readonly filename: string;
  readonly mimeType: string;
  readonly caption?: string;
};

export type SendDocumentGroupItem = {
  readonly data: Buffer;
  readonly filename: string;
  readonly mimeType: string;
};

export type SendDocumentGroupInput = {
  readonly chatId: number;
  readonly documents: readonly SendDocumentGroupItem[];
  readonly caption?: string;
  // Native task files are sent as a document album replying to the task card. Telegram then
  // keeps the files visually attached to their task without turning them into rich-message links.
  readonly replyToMessageId?: number;
};

export type EditMessageTextInput = {
  readonly chatId: number;
  readonly messageId: number;
  readonly text?: string;
  // Bot API 10.2 позволяет заменить обычный текст сообщения структурированным rich_message.
  // Используем это для мгновенной перерисовки чекбоксов внутри скрываемых сводок.
  readonly richHtml?: string;
  readonly parseMode?: 'HTML' | 'MarkdownV2';
  readonly disableWebPagePreview?: boolean;
  // null/undefined — убрать кнопки; объект — заменить.
  readonly replyMarkup?: unknown;
};

// Минимальный inline-результат (article) для Phase D. input_message_text отправляется
// в чат при выборе — мы делаем его каноническим `+<Проект> <текст> @<Ответственный>`, который
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
  // True when the request may have reached Telegram but its response was lost (timeout/reset).
  // Callers must not immediately retry with different content or they can create duplicates.
  readonly deliveryUnknown?: boolean;
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

export type TelegramDownloadedFile = {
  readonly data: Buffer;
  readonly filename: string;
  readonly mimeType: string;
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
  // Native rich HTML with optional in-flow media. Callers fall back to regular messages when
  // a test client, relay, or Telegram deployment doesn't support the method yet.
  sendRichMessage?(input: SendRichMessageInput): Promise<SendMessageResult>;
  // Удаление предыдущих ручных тестов сводки. Опционально для старых тестовых фейков.
  deleteMessages?(input: DeleteMessagesInput): Promise<void>;
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
  // Скачать входящее Telegram-вложение по file_id (getFile + /file/bot...). Опционально для
  // тестовых клиентов; если реализации нет, текстовая задача всё равно создаётся без падения.
  downloadFile?(fileId: string): Promise<TelegramDownloadedFile | null>;
  // Отправить картинки в чат: 1 → sendPhoto, 2..10 → sendMediaGroup (альбом), >10 → чанки.
  // photoUrls — публично доступные (подписанные) ссылки; Telegram сам их выкачивает.
  // Best-effort (картинки — дополнение к тексту). Опционально: тестовые фейки могут не иметь.
  sendPhotos?(chatId: number, photoUrls: readonly string[]): Promise<void>;
  // Send a native task attachment. Implementations choose photo, audio, video, animation, or
  // document by MIME and may upload bytes directly or let Telegram fetch a signed URL.
  sendAttachment?(input: SendAttachmentInput): Promise<SendMessageResult>;
  // Send ordinary task files as Telegram documents. One file uses sendDocument; 2..10 use one
  // sendMediaGroup document album; larger sets are split into Telegram-sized album chunks.
  sendDocuments?(input: SendDocumentGroupInput): Promise<readonly SendMessageResult[]>;
}

// Набор update-типов, которые мы реально обрабатываем. Используется в allowed_updates
// при setWebhook/getUpdates — снижает шум и включает доставку нажатий кнопок и inline.
export const TELEGRAM_ALLOWED_UPDATES = [
  'message',
  'callback_query',
  'inline_query',
] as const;
