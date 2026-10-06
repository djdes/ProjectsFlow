import type { LlmServerQueue } from '../../domain/llm/LlmSettings.js';
import type { ServerExecutionPolicy } from './ServerExecutionPolicy.js';

// Очередь коротких заданий, которую сервер умеет исполнять сам.
export type ServerQueueAdapter = {
  readonly queue: LlmServerQueue;
  // Атомарно забирает до `limit` ожидающих заданий и возвращает их исполнителей.
  // Каждый исполнитель сам завершает своё задание (успехом или ошибкой).
  claim(limit: number): Promise<ReadonlyArray<() => Promise<void>>>;
};

type Deps = {
  readonly policy: ServerExecutionPolicy;
  readonly adapters: readonly ServerQueueAdapter[];
  // Сколько заданий одной очереди выполняется одновременно: лимит подписки общий.
  readonly concurrencyPerQueue: number;
  readonly log?: (message: string, error?: unknown) => void;
};

// Опрашивает включённые очереди и запускает их задания через подписку.
export class ServerQueueRunner {
  private readonly inflight = new Map<LlmServerQueue, number>();
  private ticking = false;

  constructor(private readonly deps: Deps) {}

  start(intervalMs: number): () => void {
    // tick() сам ловит ошибки, но отклонённый промис в setInterval уронил бы процесс
    // (unhandledRejection в Node 22) — страхуемся и здесь.
    const timer = setInterval(() => {
      this.tick().catch((e: unknown) => this.deps.log?.('[llm-runner] сбой опроса очередей', e));
    }, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const adapter of this.deps.adapters) {
        const running = this.inflight.get(adapter.queue) ?? 0;
        const free = this.deps.concurrencyPerQueue - running;
        if (free <= 0) continue;
        let tasks: ReadonlyArray<() => Promise<void>>;
        try {
          // Политика читает настройки из БД: её сбой не должен ронять опрос остальных очередей.
          if (!(await this.deps.policy.handles(adapter.queue))) continue;
          tasks = await adapter.claim(free);
        } catch (e) {
          this.deps.log?.(`[llm-runner] ${adapter.queue}: не удалось забрать задания`, e);
          continue;
        }
        for (const task of tasks) this.launch(adapter.queue, task);
      }
    } finally {
      this.ticking = false;
    }
  }

  private launch(queue: LlmServerQueue, task: () => Promise<void>): void {
    this.inflight.set(queue, (this.inflight.get(queue) ?? 0) + 1);
    void task()
      .catch((e: unknown) => this.deps.log?.(`[llm-runner] ${queue}: задание упало`, e))
      .finally(() => this.inflight.set(queue, Math.max(0, (this.inflight.get(queue) ?? 1) - 1)));
  }
}
