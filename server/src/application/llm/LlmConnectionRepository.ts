import type {
  LlmAccountInfo,
  LlmConnection,
  LlmConnectionOwner,
  LlmConnectionStatus,
  LlmCredentials,
  LlmProvider,
} from '../../domain/llm/LlmConnection.js';

export type SaveLlmConnectionInput = {
  readonly owner: LlmConnectionOwner;
  readonly provider: LlmProvider;
  readonly credentials: LlmCredentials;
  readonly account: LlmAccountInfo;
  readonly createdBy: string | null;
};

export type UpdateLlmTokensInput = {
  readonly id: string;
  // Оптимистичная блокировка: обновляем, только если строку никто не успел обновить.
  readonly expectedVersion: number;
  readonly credentials: LlmCredentials;
  readonly account: LlmAccountInfo;
  readonly refreshedAt: Date;
};

export type LlmConnectionRepository = {
  findByOwner(owner: LlmConnectionOwner, provider: LlmProvider): Promise<LlmConnection | null>;
  findById(id: string): Promise<LlmConnection | null>;
  // Расшифрованные токены. null — строки нет или её нельзя расшифровать (сменился ключ).
  getCredentials(id: string): Promise<LlmCredentials | null>;
  // Новый вход по коду: создаёт подключение владельца или заменяет существующее (status → active).
  upsert(input: SaveLlmConnectionInput): Promise<LlmConnection>;
  // Токены после refresh. false — версия не совпала (обновил кто-то другой), ничего не записано.
  updateTokens(input: UpdateLlmTokensInput): Promise<boolean>;
  markStatus(id: string, status: LlmConnectionStatus, lastError: string | null): Promise<void>;
  markRateLimited(id: string, until: Date | null, lastError: string | null): Promise<void>;
  touchUsed(id: string, at: Date): Promise<void>;
  delete(id: string): Promise<void>;
};
