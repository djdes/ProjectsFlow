import type {
  DigestGroupHistory,
  DigestSettings,
  DigestSettingsRepository,
  SaveDigestSettingsInput,
} from '@/application/digest/DigestSettingsRepository';
import { httpClient } from './httpClient';

export class HttpDigestSettingsRepository implements DigestSettingsRepository {
  async get(projectId: string): Promise<DigestSettings> {
    const { settings } = await httpClient.get<{ settings: DigestSettings }>(
      `/projects/${projectId}/digest-settings`,
    );
    return settings;
  }

  async save(projectId: string, input: SaveDigestSettingsInput): Promise<DigestSettings> {
    const { settings } = await httpClient.put<{ settings: DigestSettings }>(
      `/projects/${projectId}/digest-settings`,
      input,
    );
    return settings;
  }

  async sendNow(projectId: string): Promise<{ taskCount: number }> {
    return httpClient.post<{ taskCount: number }>(
      `/projects/${projectId}/digest-settings/send-now`,
      {},
    );
  }

  async listGroups(projectId: string): Promise<DigestGroupHistory[]> {
    const { groups } = await httpClient.get<{ groups: DigestGroupHistory[] }>(
      `/projects/${projectId}/telegram-group-history`,
    );
    return groups;
  }

  async resolveGroupTitle(projectId: string, chatId: number): Promise<{ title: string | null }> {
    return httpClient.post<{ title: string | null }>(
      `/projects/${projectId}/telegram-group/resolve`,
      { chatId },
    );
  }
}

