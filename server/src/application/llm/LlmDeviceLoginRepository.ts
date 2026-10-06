import type { LlmConnectionOwner, LlmProvider } from '../../domain/llm/LlmConnection.js';
import type { LlmDeviceLogin } from '../../domain/llm/LlmDeviceLogin.js';

export type NewLlmDeviceLoginInput = Omit<LlmDeviceLogin, 'id' | 'createdAt'>;

export type LlmDeviceLoginRepository = {
  find(owner: LlmConnectionOwner, provider: LlmProvider): Promise<LlmDeviceLogin | null>;
  // Один активный вход на владельца и провайдера: новый заменяет прежний.
  replace(input: NewLlmDeviceLoginInput): Promise<LlmDeviceLogin>;
  delete(owner: LlmConnectionOwner, provider: LlmProvider): Promise<void>;
};
