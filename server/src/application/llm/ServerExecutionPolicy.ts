import type { LlmServerQueue } from '../../domain/llm/LlmSettings.js';
import type { LlmRouter } from './LlmRouter.js';
import type { LlmSettingsService } from './LlmSettingsService.js';

// Доступность подписки проверяется на каждом опросе очередей — кэшируем на пару секунд.
const AVAILABILITY_CACHE_MS = 3_000;

type Deps = {
  readonly settings: LlmSettingsService;
  readonly router: LlmRouter;
  readonly now?: () => number;
};

// Решает, кто исполняет очередь коротких заданий: сервер или диспетчер. Сервер берёт
// очередь, только если админ включил её И подписка сейчас доступна. Если подписка
// отключена, требует входа или упёрлась в лимит, задания остаются диспетчеру — переход
// идёт без простоя, а откат делается одной настройкой.
export class ServerExecutionPolicy {
  private availability: { value: boolean; at: number } | null = null;

  constructor(private readonly deps: Deps) {}

  // Никогда не бросает: при сбое чтения настроек задания остаются диспетчеру, как раньше.
  async handles(queue: LlmServerQueue): Promise<boolean> {
    try {
      const settings = await this.deps.settings.get();
      if (!settings.serverQueues.includes(queue)) return false;
      return await this.llmAvailable();
    } catch {
      return false;
    }
  }

  private async llmAvailable(): Promise<boolean> {
    const now = this.deps.now ? this.deps.now() : Date.now();
    if (this.availability && now - this.availability.at < AVAILABILITY_CACHE_MS) {
      return this.availability.value;
    }
    const value = await this.deps.router
      .resolve({ billedUserId: null })
      .then(() => true)
      .catch(() => false);
    this.availability = { value, at: now };
    return value;
  }
}
