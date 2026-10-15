import {
  LlmNotConnectedError,
  LlmRateLimitedError,
  LlmReauthRequiredError,
} from '../../domain/llm/errors.js';
import type {
  GenerateLlmText,
  GenerateLlmTextInput,
  GenerateLlmTextResult,
} from './LlmTextGenerator.js';

type Deps = {
  readonly primary: GenerateLlmText;
  readonly fallback: GenerateLlmText;
  readonly log?: (message: string) => void;
};

// Подписка ChatGPT недоступна (исчерпан лимит, не подключена, нужен повторный вход) — короткое
// задание выполняет запасная модель, а не падает: иначе бот неделю ставит задачи без разбора
// (без проекта, ответственного и перефразирования). Вход для запасной модели может быть
// короче основного (fallbackInput): у неё жёсткий лимит токенов на запрос.
export class FallbackLlmTextGenerator implements GenerateLlmText {
  constructor(private readonly deps: Deps) {}

  async generate(input: GenerateLlmTextInput): Promise<GenerateLlmTextResult> {
    try {
      return await this.deps.primary.generate(input);
    } catch (error) {
      if (!isSubscriptionUnavailable(error)) throw error;
      try {
        return await this.deps.fallback.generate({ ...input, input: input.fallbackInput ?? input.input });
      } catch (fallbackError) {
        // Наружу — исходная причина: «лимит подписки» понятнее ошибки запасного провайдера.
        this.deps.log?.(
          `[llm-fallback] запасная модель не ответила: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
        );
        throw error;
      }
    }
  }
}

export function isSubscriptionUnavailable(error: unknown): boolean {
  return (
    error instanceof LlmRateLimitedError ||
    error instanceof LlmNotConnectedError ||
    error instanceof LlmReauthRequiredError
  );
}
