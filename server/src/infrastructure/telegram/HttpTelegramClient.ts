import type {
  SendMessageInput,
  SendMessageResult,
  TelegramClient,
} from '../../application/telegram/TelegramClient.js';

// Реальная реализация TelegramClient на fetch. Никаких ретраев внутри —
// rate_limited/error возвращаются caller'у; caller (очередь рассылки) сам решает.

type TgResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
};

export class HttpTelegramClient implements TelegramClient {
  private readonly base: string;

  // apiBaseUrl — override https://api.telegram.org для случаев, когда хостинг блокирует
  // часть Telegram CDN (типично для RU-провайдеров: некоторые подсети api.telegram.org
  // дают ETIMEDOUT). Можно указать reverse-proxy / CF-worker как relay, например
  // 'https://tg-relay.example.com'. Без trailing slash.
  constructor(
    private readonly botToken: string,
    apiBaseUrl: string = 'https://api.telegram.org',
  ) {
    const cleaned = apiBaseUrl.replace(/\/$/, '');
    this.base = `${cleaned}/bot${botToken}`;
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    let res: Response;
    try {
      res = await fetch(`${this.base}/sendMessage`, {
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
    const res = await fetch(`${this.base}/setWebhook`, {
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
    await fetch(`${this.base}/deleteWebhook`, { method: 'POST' }).catch(() => {});
  }
}
