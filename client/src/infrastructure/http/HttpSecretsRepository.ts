import type { SecretsRepository, StoredSecretKey } from '@/application/secrets/SecretsRepository';
import { httpClient } from './httpClient';

export class HttpSecretsRepository implements SecretsRepository {
  async put(key: string, value: string): Promise<void> {
    await httpClient.put<void>('/secrets', { key, value });
  }
  async get(key: string): Promise<string> {
    const { value } = await httpClient.get<{ value: string }>(`/secrets?key=${encodeURIComponent(key)}`);
    return value;
  }
  async delete(key: string): Promise<void> {
    await httpClient.delete<void>(`/secrets?key=${encodeURIComponent(key)}`);
  }
  async list(): Promise<StoredSecretKey[]> {
    const { secrets } = await httpClient.get<{ secrets: { key: string; createdAt: string; updatedAt: string }[] }>('/secrets/list');
    return secrets.map((s) => ({
      key: s.key,
      createdAt: new Date(s.createdAt),
      updatedAt: new Date(s.updatedAt),
    }));
  }
}
