import type { LlmAdminRepository, LlmSettingsPatch } from '@/application/llm/LlmAdminRepository';
import type {
  LlmAdminStatus,
  LlmLoginPollResult,
  LlmPendingLogin,
  LlmSettings,
  LlmTestResult,
} from '@/domain/llm/LlmConnection';
import { httpClient } from './httpClient';

export class HttpLlmAdminRepository implements LlmAdminRepository {
  getStatus(): Promise<LlmAdminStatus> {
    return httpClient.get<LlmAdminStatus>('/admin/llm');
  }

  async startLogin(): Promise<LlmPendingLogin> {
    const { pendingLogin } = await httpClient.post<{ pendingLogin: LlmPendingLogin }>('/admin/llm/login', {});
    return pendingLogin;
  }

  pollLogin(): Promise<LlmLoginPollResult> {
    return httpClient.post<LlmLoginPollResult>('/admin/llm/login/poll', {});
  }

  async cancelLogin(): Promise<void> {
    await httpClient.delete<unknown>('/admin/llm/login');
  }

  async disconnect(): Promise<void> {
    await httpClient.delete<unknown>('/admin/llm');
  }

  async updateSettings(patch: LlmSettingsPatch): Promise<LlmSettings> {
    const { settings } = await httpClient.put<{ settings: LlmSettings }>('/admin/llm/settings', patch);
    return settings;
  }

  test(): Promise<LlmTestResult> {
    return httpClient.post<LlmTestResult>('/admin/llm/test', {});
  }
}
