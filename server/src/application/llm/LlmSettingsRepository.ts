import type { LlmServerQueue } from '../../domain/llm/LlmSettings.js';

// Сырые настройки из БД: null — значение не задано, действует умолчание.
export type StoredLlmSettings = {
  readonly defaultModel: string | null;
  readonly fastModel: string | null;
  readonly serverQueues: readonly LlmServerQueue[];
  readonly updatedAt: Date | null;
};

export type LlmSettingsRepository = {
  get(): Promise<StoredLlmSettings>;
  save(input: {
    readonly defaultModel: string | null;
    readonly fastModel: string | null;
    readonly serverQueues: readonly LlmServerQueue[];
    readonly updatedBy: string;
  }): Promise<void>;
};
