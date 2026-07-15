// ВАЖНО: undici fetch + ProxyAgent — не глобальный fetch (он использует встроенный
// в Node 22 undici 6.x, и dispatcher от внешнего undici 8.x даёт «invalid onRequestStart
// method»). Используем undici.fetch напрямую.
import { File } from 'node:buffer';
import { fetch as undiciFetch, FormData, ProxyAgent, type Dispatcher } from 'undici';
import {
  TELEGRAM_ALLOWED_UPDATES,
  type AnswerInlineQueryInput,
  type EditMessageTextInput,
  type SendAttachmentInput,
  type SendMessageInput,
  type SendMessageResult,
  type SendRichMessageInput,
  type TelegramBotCommand,
  type TelegramChatInfo,
  type TelegramClient,
  type TelegramUpdate,
} from '../../application/telegram/TelegramClient.js';

// Реальная реализация TelegramClient на fetch. Никаких ретраев внутри —
// rate_limited/error возвращаются caller'у; caller (очередь рассылки) сам решает.
//
// HTTP-proxy: если задан proxyUrl, все запросы идут через undici ProxyAgent. Нужно
// когда хостинг блокирует часть подсетей api.telegram.org (типично для RU-провайдеров).

type TgResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
};

// undiciFetch принимает dispatcher через init; нативный fetch — нет. Типы undici своего
// RequestInit отличаются от lib.dom, но нам достаточно minimal subset (method/headers/body).
type TgFetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string | FormData;
  dispatcher?: Dispatcher;
};

export class HttpTelegramClient implements TelegramClient {
  private readonly base: string;
  private readonly fileBase: string;
  private readonly dispatcher: Dispatcher | undefined;

  // apiBaseUrl — override https://api.telegram.org (если используется relay, например
  // CF-worker, тогда proxy не нужен).
  // proxyUrl — HTTP/HTTPS proxy URL вида 'http://user:pass@host:port'. Применяется ко всем
  // запросам к Telegram API. Если задан И apiBaseUrl — proxy всё равно применяется
  // (для случая когда relay тоже за прокси). Без proxy — прямой fetch.
  constructor(
    private readonly botToken: string,
    apiBaseUrl: string = 'https://api.telegram.org',
    proxyUrl?: string,
  ) {
    const cleaned = apiBaseUrl.replace(/\/$/, '');
    this.base = `${cleaned}/bot${botToken}`;
    this.fileBase = `${cleaned}/file/bot${botToken}`;
    this.dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
  }

  // Возвращаем Response-подобный объект из undici (status/ok/json/text — те же что у DOM).
  private async tgFetch(
    path: string,
    init?: TgFetchInit,
  ): Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }> {
    const opts: TgFetchInit = { ...init };
    if (this.dispatcher) opts.dispatcher = this.dispatcher;
    return undiciFetch(`${this.base}${path}`, opts);
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    let res: Awaited<ReturnType<typeof this.tgFetch>>;
    try {
      res = await this.tgFetch('/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: input.chatId,
          text: input.text,
          parse_mode: input.parseMode,
          disable_web_page_preview: input.disableWebPagePreview,
          reply_markup: input.replyMarkup,
        }),
      });
    } catch (err) {
      return { kind: 'error', description: (err as Error).message };
    }

    const body = (await res.json().catch(() => null)) as TgResponse<{
      message_id: number;
    }> | null;

    if (res.ok && body?.ok && body.result) {
      return { kind: 'ok', messageId: body.result.message_id };
    }

    if (res.status === 403) {
      return { kind: 'forbidden', description: body?.description ?? 'forbidden' };
    }

    if (res.status === 429) {
      const retryAfter = body?.parameters?.retry_after ?? 1;
      return { kind: 'rate_limited', retryAfter };
    }

    return {
      kind: 'error',
      description: body?.description ?? `HTTP ${res.status}`,
    };
  }

  // Bot API 10.2 rich messages support native structured HTML and media blocks. If a relay or
  // API deployment doesn't support them, the caller falls back to ordinary ordered messages.
  async sendRichMessage(input: SendRichMessageInput): Promise<SendMessageResult> {
    let res: Awaited<ReturnType<typeof this.tgFetch>>;
    try {
      res = await this.tgFetch('/sendRichMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: input.chatId,
          rich_message: {
            html: input.html,
            media: input.media?.map((item) => ({
              id: item.id,
              media: {
                type: item.kind,
                media: item.url,
              },
            })),
          },
          reply_markup: input.replyMarkup,
        }),
      });
    } catch (err) {
      return { kind: 'error', description: (err as Error).message };
    }

    const body = (await res.json().catch(() => null)) as TgResponse<{
      message_id: number;
    }> | null;

    if (res.ok && body?.ok && body.result) {
      return { kind: 'ok', messageId: body.result.message_id };
    }
    if (res.status === 403) {
      return { kind: 'forbidden', description: body?.description ?? 'forbidden' };
    }
    if (res.status === 429) {
      return { kind: 'rate_limited', retryAfter: body?.parameters?.retry_after ?? 1 };
    }
    return { kind: 'error', description: body?.description ?? `HTTP ${res.status}` };
  }

  // Редактирование текста+кнопок ранее отправленного сообщения. Best-effort: ошибки
  // (сообщение слишком старое / уже удалено / «message is not modified») глотаем — это не
  // критичный путь (конструктор просто не сможет «закрасить» карточку, но задача уже создана).
  async editMessageText(input: EditMessageTextInput): Promise<void> {
    await this.tgFetch('/editMessageText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: input.chatId,
        message_id: input.messageId,
        text: input.text,
        parse_mode: input.parseMode,
        disable_web_page_preview: input.disableWebPagePreview,
        reply_markup: input.replyMarkup,
      }),
    }).catch(() => {});
  }

  // Гасит «часики» на нажатой кнопке + опциональный тост/алерт. Best-effort.
  async answerCallbackQuery(
    callbackQueryId: string,
    opts?: { text?: string; showAlert?: boolean },
  ): Promise<void> {
    await this.tgFetch('/answerCallbackQuery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: opts?.text,
        show_alert: opts?.showAlert,
      }),
    }).catch(() => {});
  }

  // Ответ на inline_query (Phase D). Best-effort.
  async answerInlineQuery(input: AnswerInlineQueryInput): Promise<void> {
    await this.tgFetch('/answerInlineQuery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inline_query_id: input.inlineQueryId,
        results: input.results,
        cache_time: input.cacheTime ?? 0,
        is_personal: input.isPersonal,
        switch_pm_text: input.switchPmText,
        switch_pm_parameter: input.switchPmParameter,
      }),
    }).catch(() => {});
  }

  async setWebhook(url: string, secretToken: string): Promise<void> {
    const res = await this.tgFetch('/setWebhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        secret_token: secretToken,
        // message + callback_query (кнопки конструктора) + inline_query (Phase D).
        allowed_updates: TELEGRAM_ALLOWED_UPDATES,
      }),
    });
    const body = (await res.json().catch(() => null)) as TgResponse<true> | null;
    if (!res.ok || !body?.ok) {
      throw new Error(`setWebhook failed: ${body?.description ?? res.status}`);
    }
  }

  async setMyCommands(commands: readonly TelegramBotCommand[]): Promise<void> {
    // Best-effort: меню команд — приятный бонус, его сбой не должен ронять старт.
    await this.tgFetch('/setMyCommands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands }),
    }).catch(() => {});
  }

  async deleteWebhook(): Promise<void> {
    await this.tgFetch('/deleteWebhook', { method: 'POST' }).catch(() => {});
  }

  // getChat — метаданные чата (название группы). Best-effort: при любой ошибке/отказе
  // (бот не в группе, нет прав, сеть) возвращаем null, чтобы резолв имени не ронял UI.
  async getChat(chatId: number): Promise<TelegramChatInfo | null> {
    let res: Awaited<ReturnType<typeof this.tgFetch>>;
    try {
      res = await this.tgFetch('/getChat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId }),
      });
    } catch {
      return null;
    }
    const body = (await res.json().catch(() => null)) as TgResponse<{
      id: number;
      title?: string;
      type: string;
    }> | null;
    if (!res.ok || !body?.ok || !body.result) return null;
    return {
      id: body.result.id,
      title: body.result.title ?? null,
      type: body.result.type,
    };
  }

  async downloadFile(fileId: string): Promise<{ data: Buffer; filename: string; mimeType: string } | null> {
    try {
      const metaRes = await this.tgFetch('/getFile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: fileId }),
      });
      const meta = (await metaRes.json().catch(() => null)) as TgResponse<{ file_path?: string }> | null;
      const filePath = meta?.result?.file_path;
      if (!metaRes.ok || !meta?.ok || !filePath) return null;

      const init: { dispatcher?: Dispatcher } = {};
      if (this.dispatcher) init.dispatcher = this.dispatcher;
      const fileRes = await undiciFetch(`${this.fileBase}/${filePath}`, init);
      if (!fileRes.ok) return null;
      const data = Buffer.from(await fileRes.arrayBuffer());
      const filename = filePath.split('/').pop() || 'telegram-photo.jpg';
      const ext = filename.split('.').pop()?.toLowerCase();
      const mimeType =
        fileRes.headers.get('content-type')?.split(';', 1)[0] ||
        (ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
      return { data, filename, mimeType };
    } catch (err) {
      console.warn('[telegram] downloadFile failed:', err);
      return null;
    }
  }

  async sendAttachment(input: SendAttachmentInput): Promise<SendMessageResult> {
    const mime = input.mimeType.toLowerCase();
    const preferred = mime === 'image/gif'
      ? { endpoint: '/sendAnimation', field: 'animation' }
      : mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp'
        ? { endpoint: '/sendPhoto', field: 'photo' }
        : mime.startsWith('audio/')
          ? { endpoint: '/sendAudio', field: 'audio' }
          : mime.startsWith('video/')
            ? { endpoint: '/sendVideo', field: 'video' }
            : { endpoint: '/sendDocument', field: 'document' };

    const sendUsing = async (target: { endpoint: string; field: string }): Promise<SendMessageResult> => {
      let res: Awaited<ReturnType<typeof this.tgFetch>>;
      try {
        let init: TgFetchInit;
        if (input.data) {
          const form = new FormData();
          form.set('chat_id', String(input.chatId));
          form.set(
            target.field,
            new File([new Uint8Array(input.data)], input.filename, {
              type: input.mimeType || 'application/octet-stream',
            }),
          );
          if (input.caption) form.set('caption', input.caption);
          init = { method: 'POST', body: form };
        } else if (input.url) {
          init = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: input.chatId,
              [target.field]: input.url,
              caption: input.caption,
            }),
          };
        } else {
          return { kind: 'error', description: 'attachment source is missing' };
        }
        res = await this.tgFetch(target.endpoint, init);
      } catch (err) {
        return { kind: 'error', description: (err as Error).message };
      }

      const body = (await res.json().catch(() => null)) as TgResponse<{
        message_id: number;
      }> | null;
      if (res.ok && body?.ok && body.result) {
        return { kind: 'ok', messageId: body.result.message_id };
      }
      if (res.status === 403) {
        return { kind: 'forbidden', description: body?.description ?? 'forbidden' };
      }
      if (res.status === 429) {
        return { kind: 'rate_limited', retryAfter: body?.parameters?.retry_after ?? 1 };
      }
      return { kind: 'error', description: body?.description ?? `HTTP ${res.status}` };
    };

    const result = await sendUsing(preferred);
    // Telegram accepts fewer codecs as playable media than browsers do. Preserve delivery by
    // retrying an unsupported photo/audio/video/animation as a regular document.
    if (result.kind === 'error' && preferred.field !== 'document') {
      return sendUsing({ endpoint: '/sendDocument', field: 'document' });
    }
    return result;
  }

  // Картинки в чат: 1 → sendPhoto, 2..10 → sendMediaGroup, >10 → чанки по 10. Best-effort:
  // картинки — дополнение к текстовому сообщению, их сбой не должен ронять доставку текста.
  async sendPhotos(chatId: number, photoUrls: readonly string[]): Promise<void> {
    const urls = photoUrls.filter((u) => u.length > 0);
    for (let i = 0; i < urls.length; i += 10) {
      const batch = urls.slice(i, i + 10);
      try {
        if (batch.length === 1) {
          await this.tgFetch('/sendPhoto', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, photo: batch[0] }),
          });
        } else {
          await this.tgFetch('/sendMediaGroup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              media: batch.map((url) => ({ type: 'photo', media: url })),
            }),
          });
        }
      } catch {
        /* best-effort — картинки не критичны */
      }
    }
  }

  async getUpdates(offset: number, timeoutSeconds: number): Promise<TelegramUpdate[]> {
    // long-poll: undici keep-alive держит соединение открытым timeoutSeconds. Нам важно
    // дать proxy чуть больше времени чтоб не порвал раньше TG (timeoutSeconds + 5).
    const res = await this.tgFetch('/getUpdates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        offset,
        timeout: timeoutSeconds,
        allowed_updates: TELEGRAM_ALLOWED_UPDATES,
      }),
    });
    const body = (await res.json().catch(() => null)) as TgResponse<TelegramUpdate[]> | null;
    if (!res.ok || !body?.ok) {
      throw new Error(`getUpdates failed: ${body?.description ?? res.status}`);
    }
    return body.result ?? [];
  }
}
