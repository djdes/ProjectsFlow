import type { LlmServerQueue } from '../../domain/llm/LlmSettings.js';
import type { LlmSettingsService } from './LlmSettingsService.js';

type Deps = {
  readonly settings: LlmSettingsService;
};

// Решает, кто исполняет очередь коротких заданий: сервер или диспетчер. Включённую админом
// очередь сервер берёт всегда. Отката на диспетчера нет: модель у него та же подписка GPT
// (через шлюз), поэтому при недоступной подписке задание сразу завершается понятной
// ошибкой, а не висит до таймаута диспетчера.
export class ServerExecutionPolicy {
  constructor(private readonly deps: Deps) {}

  // Никогда не бросает: при сбое чтения настроек задания остаются диспетчеру, как раньше.
  async handles(queue: LlmServerQueue): Promise<boolean> {
    try {
      const settings = await this.deps.settings.get();
      return settings.serverQueues.includes(queue);
    } catch {
      return false;
    }
  }
}
