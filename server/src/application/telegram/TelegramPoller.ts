import type { TelegramClient, TelegramUpdate } from './TelegramClient.js';
import type {
  HandleTelegramWebhook,
  TelegramUpdate as HandlerUpdate,
} from './HandleTelegramWebhook.js';

type Deps = {
  readonly client: TelegramClient;
  readonly handler: HandleTelegramWebhook;
};

// Polling-fallback для случая когда хостинг блокирует inbound от Telegram (типично
// RU-провайдеры режут IP Telegram во ВСЕ стороны). Мы сами long-poll'им getUpdates
// (через тот же proxy что и sendMessage) → нет необходимости в публичном webhook.
//
// Сначала deleteWebhook — Telegram не даёт getUpdates пока webhook зарегистрирован
// (вернёт 409 Conflict). Потом цикл getUpdates(offset, timeout=25) пока не stop()'нут.
export class TelegramPoller {
  private offset = 0;
  private running = false;
  private currentLoop: Promise<void> | null = null;

  constructor(private readonly deps: Deps) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    // Очищаем webhook чтоб getUpdates не упал 409. Best-effort — если webhook был
    // не зарегистрирован, deleteWebhook просто вернёт ok:true.
    try {
      await this.deps.client.deleteWebhook();
    } catch (err) {
      console.warn('[tg-poller] deleteWebhook failed (continuing):', err);
    }
    console.log('[tg-poller] polling started');
    this.currentLoop = this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    // Не отменяем висящий long-poll принудительно — он сам завершится по timeout'у
    // на стороне Telegram (≤30c). Просто ждём пока loop увидит !running и выйдет.
    if (this.currentLoop) await this.currentLoop.catch(() => {});
    this.currentLoop = null;
    console.log('[tg-poller] polling stopped');
  }

  private async loop(): Promise<void> {
    // Backoff при ошибках сети, чтобы не задолбить proxy в петле.
    let consecutiveErrors = 0;
    while (this.running) {
      try {
        const updates = await this.deps.client.getUpdates(this.offset, 25);
        consecutiveErrors = 0;
        for (const u of updates) {
          // ack: бамп offset ДО обработки, чтобы плохой апдейт не зациклил нас.
          this.offset = Math.max(this.offset, u.update_id + 1);
          try {
            await this.deps.handler.execute(u as unknown as HandlerUpdate);
          } catch (err) {
            console.warn('[tg-poller] handler failed for update', u.update_id, err);
          }
        }
      } catch (err) {
        consecutiveErrors += 1;
        // Min 1s, exponential до 30s. ETIMEDOUT/network — типичная флоп.
        const wait = Math.min(30_000, 1_000 * 2 ** Math.min(5, consecutiveErrors));
        console.warn(
          `[tg-poller] getUpdates failed (try=${consecutiveErrors}, sleep=${wait}ms):`,
          (err as Error).message,
        );
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
}
