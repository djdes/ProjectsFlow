// Порт к Telegram Bot API. Реальная реализация — HttpTelegramClient (fetch);
// в тестах подменяется фейком. Не возвращает «весь» Telegram-ответ — только то, что
// нам нужно (message_id для аудита, тип ошибки для дедупа/блока).

export type SendMessageInput = {
  readonly chatId: number;
  readonly text: string;
  readonly parseMode?: 'HTML' | 'MarkdownV2';
  readonly disableWebPagePreview?: boolean;
  // Произвольный inline_keyboard / reply_keyboard. Структура — как в TG Bot API.
  readonly replyMarkup?: unknown;
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

export interface TelegramClient {
  // Возвращает дискриминированный результат — caller сам решает что логировать/повторять.
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
  // Регистрация webhook'а на старте сервера. Идемпотентно — TG перезаписывает.
  // secret_token валидируется в webhook handler через X-Telegram-Bot-Api-Secret-Token.
  setWebhook(url: string, secretToken: string): Promise<void>;
  // Сброс webhook'а — для dev/cleanup.
  deleteWebhook(): Promise<void>;
}
