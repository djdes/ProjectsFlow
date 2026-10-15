import { fetch as undiciFetch, ProxyAgent, type Dispatcher } from 'undici';
import type {
  GenerateLlmText,
  GenerateLlmTextInput,
  GenerateLlmTextResult,
} from '../../application/llm/LlmTextGenerator.js';

const DEFAULT_API_BASE_URL = 'https://api.groq.com';
// Открытая модель OpenAI: понимает те же промпты и строгие JSON-схемы, что и основная.
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

export type GroqTextGeneratorOptions = {
  readonly apiKey: string;
  readonly apiBaseUrl?: string;
  readonly model?: string;
  // Прод вне региона Groq — тот же исходящий прокси, что у Telegram и расшифровки голоса.
  readonly proxyUrl?: string;
  readonly fetchImpl?: typeof undiciFetch;
};

type ChatCompletion = {
  readonly model?: string;
  readonly choices?: readonly { readonly message?: { readonly content?: unknown } }[];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    readonly completion_tokens_details?: { readonly reasoning_tokens?: number };
  };
  readonly error?: { readonly message?: unknown };
};

// Запасная модель для коротких заданий (см. FallbackLlmTextGenerator): Groq, OpenAI-совместимый
// chat/completions. Ключ уже есть на сервере — он же расшифровывает голосовые.
export class GroqTextGenerator implements GenerateLlmText {
  private readonly apiKey: string;
  private readonly apiBaseUrl: string;
  private readonly model: string;
  private readonly dispatcher: Dispatcher | undefined;
  private readonly fetchImpl: typeof undiciFetch;

  constructor(options: GroqTextGeneratorOptions) {
    this.apiKey = options.apiKey.trim();
    this.apiBaseUrl = (options.apiBaseUrl?.trim() || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
    this.model = options.model?.trim() || DEFAULT_MODEL;
    this.dispatcher = options.proxyUrl?.trim() ? new ProxyAgent(options.proxyUrl.trim()) : undefined;
    this.fetchImpl = options.fetchImpl ?? undiciFetch;
  }

  get enabled(): boolean {
    return this.apiKey.length > 0;
  }

  async generate(input: GenerateLlmTextInput): Promise<GenerateLlmTextResult> {
    if (!this.enabled) throw new Error('Groq text generation is not configured');
    const timeout = AbortSignal.timeout(input.timeoutMs);
    const response = await this.fetchImpl(`${this.apiBaseUrl}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: input.instructions },
          { role: 'user', content: input.input },
        ],
        // Рассуждения тоже считаются в лимит токенов в минуту — для коротких заданий хватает low.
        reasoning_effort: 'low',
        ...(input.jsonSchema
          ? {
              response_format: {
                type: 'json_schema',
                json_schema: { name: input.jsonSchema.name, schema: input.jsonSchema.schema, strict: true },
              },
            }
          : {}),
      }),
      signal: input.signal ? AbortSignal.any([input.signal, timeout]) : timeout,
      ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
    });
    const data = (await response.json().catch(() => null)) as ChatCompletion | null;
    if (!response.ok) {
      const message =
        typeof data?.error?.message === 'string' ? data.error.message.replace(/\s+/g, ' ').slice(0, 240) : '';
      throw new Error(`Groq HTTP ${response.status}${message ? `: ${message}` : ''}`);
    }
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || text.trim().length === 0) throw new Error('Groq returned an empty answer');
    const usage = data?.usage;
    return {
      text,
      model: data?.model ?? this.model,
      usage: usage
        ? {
            inputTokens: usage.prompt_tokens ?? 0,
            cachedInputTokens: 0,
            outputTokens: usage.completion_tokens ?? 0,
            reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
          }
        : null,
      // Бесплатный тариф Groq: в «API-эквиваленте» не считаем.
      costUsd: null,
    };
  }
}
