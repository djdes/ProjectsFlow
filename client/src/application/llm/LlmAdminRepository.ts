import type {
  LlmAdminStatus,
  LlmLoginPollResult,
  LlmPendingLogin,
  LlmServerQueue,
  LlmSettings,
  LlmTestResult,
} from '@/domain/llm/LlmConnection';

export type LlmSettingsPatch = {
  readonly defaultModel?: string | null;
  readonly fastModel?: string | null;
  readonly serverQueues?: readonly LlmServerQueue[];
};

// Подключение платформенной подписки ChatGPT по коду (только для админов).
export interface LlmAdminRepository {
  getStatus(): Promise<LlmAdminStatus>;
  startLogin(): Promise<LlmPendingLogin>;
  // Один шаг проверки подтверждения кода; клиент зовёт с интервалом от провайдера.
  pollLogin(): Promise<LlmLoginPollResult>;
  cancelLogin(): Promise<void>;
  disconnect(): Promise<void>;
  updateSettings(patch: LlmSettingsPatch): Promise<LlmSettings>;
  // Короткий настоящий запрос к модели с сервера: токены, сеть, лимиты.
  test(): Promise<LlmTestResult>;
}
