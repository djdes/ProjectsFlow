import type {
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
}

