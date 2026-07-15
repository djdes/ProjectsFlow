import type { TelegramClient, TelegramUpdate } from './TelegramClient.js';
import type {
  HandleTelegramWebhook,
  TelegramUpdate as HandlerUpdate,
} from './HandleTelegramWebhook.js';

type Deps = {
  readonly client: TelegramClient;
  readonly handler: HandleTelegramWebhook;
  // Test seam for retry backoff. Production uses a regular timer.
  readonly sleep?: (milliseconds: number) => Promise<void>;
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
        const received = await this.deps.client.getUpdates(this.offset, 25);
        // Telegram normally returns updates in ascending order. Sorting here makes the ack
        // rule explicit and keeps a relay/test double from advancing past an earlier update.
        const updates = [...received]
          .filter((update) => update.update_id >= this.offset)
          .sort((a, b) => a.update_id - b.update_id);

        // Preserve Telegram order so a successful callback is never executed again merely
        // because an earlier update failed. Media-group parts are the only exception: Handler's
        // debounce must see them together to persist one album/draft. AI compose itself is now
        // background work, so ordinary task messages no longer serialize a long model request.
        const processed = updates.map(() => false);
        let failed = false;
        for (let i = 0; i < updates.length; i += 1) {
          if (processed[i]) continue;
          const groupKey = this.mediaGroupKey(updates[i]);
          const indexes = groupKey
            ? updates.flatMap((update, index) =>
                !processed[index] && this.mediaGroupKey(update) === groupKey ? [index] : [],
              )
            : [i];
          const results = await Promise.allSettled(
            indexes.map((index) =>
              this.deps.handler.execute(updates[index] as unknown as HandlerUpdate),
            ),
          );
          for (let resultIndex = 0; resultIndex < results.length; resultIndex += 1) {
            const result = results[resultIndex];
            const updateIndex = indexes[resultIndex];
            if (result?.status === 'fulfilled' && updateIndex !== undefined) {
              processed[updateIndex] = true;
              continue;
            }
            if (result?.status === 'rejected') {
              console.warn(
                '[tg-poller] handler failed for update',
                updateIndex === undefined ? undefined : updates[updateIndex]?.update_id,
                result.reason,
              );
            }
            failed = true;
          }

          // Ack only the continuously processed prefix. A successful later album part is safe
          // to replay (source_key deduplicates it), while later callbacks are never started after
          // the first failed unit and therefore cannot toggle twice.
          let prefixLength = 0;
          while (processed[prefixLength]) prefixLength += 1;
          if (prefixLength > 0) {
            this.offset = Math.max(this.offset, updates[prefixLength - 1]!.update_id + 1);
          }
          if (failed) break;
        }

        if (failed) {
          consecutiveErrors += 1;
          const wait = this.backoffMs(consecutiveErrors);
          await this.sleep(wait);
        } else {
          consecutiveErrors = 0;
        }
      } catch (err) {
        consecutiveErrors += 1;
        // Min 1s, exponential до 30s. ETIMEDOUT/network — типичная флоп.
        const wait = this.backoffMs(consecutiveErrors);
        console.warn(
          `[tg-poller] getUpdates failed (try=${consecutiveErrors}, sleep=${wait}ms):`,
          (err as Error).message,
        );
        await this.sleep(wait);
      }
    }
  }

  private backoffMs(consecutiveErrors: number): number {
    return Math.min(30_000, 1_000 * 2 ** Math.min(5, consecutiveErrors));
  }

  private mediaGroupKey(update: TelegramUpdate | undefined): string | null {
    const message = update?.message as
      | {
          readonly media_group_id?: unknown;
          readonly chat?: { readonly id?: unknown };
          readonly from?: { readonly id?: unknown };
        }
      | undefined;
    if (typeof message?.media_group_id !== 'string' || message.media_group_id.length === 0) {
      return null;
    }
    return `${String(message.chat?.id ?? '')}:${String(message.from?.id ?? '')}:${message.media_group_id}`;
  }

  private sleep(milliseconds: number): Promise<void> {
    return this.deps.sleep
      ? this.deps.sleep(milliseconds)
      : new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
