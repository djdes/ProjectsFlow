import { ProxyAgent, type Dispatcher } from 'undici';
import type {
  SendMessageInput,
  SendMessageResult,
  TelegramClient,
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

// node fetch (undici) принимает dispatcher через init, но в стандартных типах RequestInit
// его нет. Используем `& { dispatcher?: Dispatcher }` чтобы оставить TS строгим.
type FetchInit = RequestInit & { dispatcher?: Dispatcher };

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

  private async tgFetch(path: string, init?: FetchInit): Promise<Response> {
    const opts: FetchInit = { ...init };
    if (this.dispatcher) opts.dispatcher = this.dispatcher;
    return fetch(`${this.base}${path}`, opts as RequestInit);
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    let res: Response;
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
}
