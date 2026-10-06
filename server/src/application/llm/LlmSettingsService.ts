import {
  DEFAULT_LLM_FAST_MODEL,
  DEFAULT_LLM_MODEL,
  isLlmServerQueue,
  type LlmServerQueue,
  type LlmSettings,
} from '../../domain/llm/LlmSettings.js';
import { LlmInvalidSettingsError } from '../../domain/llm/errors.js';
import type { LlmSettingsRepository } from './LlmSettingsRepository.js';

const MODEL_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/i;
// Настройки читаются на каждом задании и каждом опросе очереди — кэшируем ненадолго.
const CACHE_TTL_MS = 5_000;

type Deps = {
  readonly settings: LlmSettingsRepository;
  readonly now?: () => number;
};

export type UpdateLlmSettingsInput = {
  readonly actorUserId: string;
  readonly defaultModel?: string | null;
  readonly fastModel?: string | null;
  readonly serverQueues?: readonly string[];
};

export class LlmSettingsService {
  private cache: { value: LlmSettings; at: number } | null = null;

  constructor(private readonly deps: Deps) {}

  async get(): Promise<LlmSettings> {
    const now = this.now();
    if (this.cache && now - this.cache.at < CACHE_TTL_MS) return this.cache.value;
    const stored = await this.deps.settings.get();
    const value: LlmSettings = {
      defaultModel: stored.defaultModel ?? DEFAULT_LLM_MODEL,
      fastModel: stored.fastModel ?? DEFAULT_LLM_FAST_MODEL,
      serverQueues: stored.serverQueues,
      updatedAt: stored.updatedAt,
    };
    this.cache = { value, at: now };
    return value;
  }

  async update(input: UpdateLlmSettingsInput): Promise<LlmSettings> {
    const current = await this.deps.settings.get();
    const defaultModel = normalizeModel(input.defaultModel, current.defaultModel);
    const fastModel = normalizeModel(input.fastModel, current.fastModel);
    let serverQueues: readonly LlmServerQueue[] = current.serverQueues;
    if (input.serverQueues !== undefined) {
      const invalid = input.serverQueues.filter((q) => !isLlmServerQueue(q));
      if (invalid.length > 0) {
        throw new LlmInvalidSettingsError(`Неизвестные очереди: ${invalid.join(', ')}`);
      }
      serverQueues = [...new Set(input.serverQueues)] as LlmServerQueue[];
    }
    await this.deps.settings.save({
      defaultModel,
      fastModel,
      serverQueues,
      updatedBy: input.actorUserId,
    });
    this.cache = null;
    return this.get();
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }
}

// undefined — не менять; null или пустая строка — вернуть умолчание.
function normalizeModel(next: string | null | undefined, current: string | null): string | null {
  if (next === undefined) return current;
  if (next === null) return null;
  const trimmed = next.trim();
  if (trimmed.length === 0) return null;
  if (!MODEL_RE.test(trimmed)) {
    throw new LlmInvalidSettingsError(`Некорректное имя модели: ${trimmed}`);
  }
  return trimmed;
}
