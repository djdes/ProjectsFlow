import { httpClient } from './httpClient';
import type {
  TelegramLoginPayload,
  TelegramPrefs,
  TelegramRepository,
  TelegramStatus,
} from '@/application/telegram/TelegramRepository';

export class HttpTelegramRepository implements TelegramRepository {
  async getStatus(): Promise<TelegramStatus> {
    return httpClient.get<TelegramStatus>('/me/telegram');
  }

  async connect(payload: TelegramLoginPayload): Promise<TelegramStatus> {
    const res = await httpClient.post<TelegramStatus & { ok: boolean }>(
      '/me/telegram/connect',
      payload,
    );
    return res;
  }

  async disconnect(): Promise<void> {
    await httpClient.delete<void>('/me/telegram');
  }

  async updatePrefs(prefs: Partial<TelegramPrefs>): Promise<TelegramStatus> {
    return httpClient.patch<TelegramStatus>('/me/telegram/prefs', prefs);
  }
}
