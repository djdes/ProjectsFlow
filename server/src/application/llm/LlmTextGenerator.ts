import type { LlmConnection } from '../../domain/llm/LlmConnection.js';
import { modelForTier, type LlmModelTier } from '../../domain/llm/LlmSettings.js';
import {
  LlmRateLimitedError,
  LlmReauthRequiredError,
  LlmUnauthorizedError,
} from '../../domain/llm/errors.js';
import { estimateCostUsdDetailed } from '../../domain/usage/pricing.js';
import type { LlmAccessService } from './LlmAccessService.js';
import type { LlmConnectionRepository } from './LlmConnectionRepository.js';
import type { LlmRouter } from './LlmRouter.js';
import type { LlmSettingsService } from './LlmSettingsService.js';
import type {
  LlmReasoningEffort,
  LlmTextResult,
  LlmTransport,
  LlmUsage,
} from './LlmTransport.js';

// Если провайдер не сказал время сброса, это скорее короткий всплеск, а не исчерпанная
// подписка, — делаем короткую паузу.
const DEFAULT_COOLDOWN_MS = 60 * 1000;

export type GenerateLlmTextInput = {
  // На кого записывается задание — от этого зависит выбор подключения (LlmRouter).
  readonly billedUserId: string | null;
  readonly tier: LlmModelTier;
  readonly instructions: string;
  readonly input: string;
  readonly reasoningEffort?: LlmReasoningEffort;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
};

export type GenerateLlmTextResult = {
  readonly text: string;
  readonly model: string;
  readonly usage: LlmUsage | null;
  // «API-эквивалент» по прайсу модели: на подписке реальная цена 0, но лимиты тарифов
  // пользователей считаются в долларах. null — модели нет в прайсе.
  readonly costUsd: number | null;
};

// Порт для исполнителей заданий: им не нужно знать про подключения, токены и провайдера.
export type GenerateLlmText = {
  generate(input: GenerateLlmTextInput): Promise<GenerateLlmTextResult>;
};

type Deps = {
  readonly router: LlmRouter;
  readonly access: LlmAccessService;
  readonly transport: LlmTransport;
  readonly settings: LlmSettingsService;
  readonly connections: LlmConnectionRepository;
  readonly now?: () => Date;
};

export class LlmTextGenerator implements GenerateLlmText {
  constructor(private readonly deps: Deps) {}

  async generate(input: GenerateLlmTextInput): Promise<GenerateLlmTextResult> {
    const connection = await this.deps.router.resolve({ billedUserId: input.billedUserId });
    const settings = await this.deps.settings.get();
    const model = modelForTier(settings, input.tier);
    const result = await this.callWithRetry(connection, {
      model,
      instructions: input.instructions,
      input: input.input,
      reasoningEffort: input.reasoningEffort ?? (input.tier === 'fast' ? 'low' : 'medium'),
      timeoutMs: input.timeoutMs,
      signal: input.signal,
    });
    void this.deps.connections.touchUsed(connection.id, this.now()).catch(() => {});
    const usage = result.usage;
    return {
      text: result.text,
      model: result.model || model,
      usage,
      costUsd: usage
        ? estimateCostUsdDetailed(result.model || model, {
            tokensIn: usage.inputTokens,
            cachedTokensIn: usage.cachedInputTokens,
            tokensOut: usage.outputTokens,
          })
        : null,
    };
  }

  private async callWithRetry(
    connection: LlmConnection,
    request: Parameters<LlmTransport['generateText']>[1],
  ): Promise<LlmTextResult> {
    let grant = await this.deps.access.acquire(connection.id);
    try {
      return await this.deps.transport.generateText(grant.access, request);
    } catch (e) {
      if (e instanceof LlmUnauthorizedError) {
        // Токен отвергнут раньше срока — обновляем и повторяем один раз.
        grant = await this.deps.access.acquire(connection.id, {
          rejectedAccessToken: grant.access.accessToken,
        });
        try {
          return await this.deps.transport.generateText(grant.access, request);
        } catch (retryError) {
          if (retryError instanceof LlmUnauthorizedError) {
            await this.deps.connections.markStatus(connection.id, 'reauth_required', 'unauthorized');
            throw new LlmReauthRequiredError(connection.id, 'unauthorized');
          }
          throw await this.onFailure(connection, retryError);
        }
      }
      throw await this.onFailure(connection, e);
    }
  }

  private async onFailure(connection: LlmConnection, error: unknown): Promise<unknown> {
    if (error instanceof LlmRateLimitedError) {
      const until = error.resetsAt ?? new Date(this.now().getTime() + DEFAULT_COOLDOWN_MS);
      await this.deps.connections
        .markRateLimited(connection.id, until, error.message)
        .catch(() => {});
    }
    return error;
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }
}
