import {
  PLATFORM_OWNER,
  type LlmConnection,
  type LlmProvider,
} from '../../domain/llm/LlmConnection.js';
import {
  LlmNotConnectedError,
  LlmRateLimitedError,
  LlmReauthRequiredError,
} from '../../domain/llm/errors.js';
import type { LlmConnectionRepository } from './LlmConnectionRepository.js';

export type LlmRouteContext = {
  // Чей это запрос: на кого записывается расход задания. null — системный запрос.
  readonly billedUserId: string | null;
};

type Deps = {
  readonly connections: LlmConnectionRepository;
  readonly provider: LlmProvider;
  readonly now?: () => Date;
};

// Выбирает подключение для запроса. Порядок:
//  1. личное подключение пользователя, на которого записывается задание (если он его сделал);
//  2. подключение платформы.
// Сейчас личных подключений нет — входа по коду в профиле пока не сделано, и ветка 1 ничего
// не находит. Когда он появится, добавится только интерфейс: шлюз, очереди и Ralph не меняются.
export class LlmRouter {
  constructor(private readonly deps: Deps) {}

  async resolve(context: LlmRouteContext): Promise<LlmConnection> {
    if (context.billedUserId) {
      const own = await this.deps.connections.findByOwner(
        { scope: 'user', userId: context.billedUserId },
        this.deps.provider,
      );
      if (own && own.status === 'active' && !this.isCoolingDown(own)) return own;
    }

    const platform = await this.deps.connections.findByOwner(PLATFORM_OWNER, this.deps.provider);
    if (!platform || platform.status === 'disabled') throw new LlmNotConnectedError();
    if (platform.status === 'reauth_required') {
      throw new LlmReauthRequiredError(platform.id, platform.lastError ?? 'reauth_required');
    }
    if (this.isCoolingDown(platform)) {
      // Подписка в лимите — не долбим провайдера до времени сброса.
      throw new LlmRateLimitedError(platform.rateLimitedUntil);
    }
    return platform;
  }

  private isCoolingDown(connection: LlmConnection): boolean {
    const now = this.deps.now ? this.deps.now() : new Date();
    return connection.rateLimitedUntil !== null && connection.rateLimitedUntil > now;
  }
}
