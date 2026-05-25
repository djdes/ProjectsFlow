// ВАЖНО: undici fetch + ProxyAgent — не глобальный fetch (он использует встроенный
// в Node 22 undici 6.x, и dispatcher от внешнего undici 8.x даёт «invalid onRequestStart
// method»). Используем undici.fetch напрямую.
import { fetch as undiciFetch, ProxyAgent, type Dispatcher } from 'undici';
import type {
  SendMessageInput,
  SendMessageResult,
  TelegramClient,
  TelegramUpdate,
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
  body?: string;
  dispatcher?: Dispatcher;
};

export class HttpTelegramClient implements TelegramClient {
  private readonly base: string;
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

  async setWebhook(url: string, secretToken: string): Promise<void> {
    const res = await this.tgFetch('/setWebhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        secret_token: secretToken,
        // Только то что мы реально обрабатываем — снижает шум.
        allowed_updates: ['message'],
      }),
    });
    const body = (await res.json().catch(() => null)) as TgResponse<true> | null;
    if (!res.ok || !body?.ok) {
      throw new Error(`setWebhook failed: ${body?.description ?? res.status}`);
    }
  }

  async deleteWebhook(): Promise<void> {
    await this.tgFetch('/deleteWebhook', { method: 'POST' }).catch(() => {});
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
        allowed_updates: ['message'],
      }),
    });
    const body = (await res.json().catch(() => null)) as TgResponse<TelegramUpdate[]> | null;
    if (!res.ok || !body?.ok) {
      throw new Error(`getUpdates failed: ${body?.description ?? res.status}`);
    }
    return body.result ?? [];
  }
}
