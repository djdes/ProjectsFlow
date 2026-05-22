import type { SecretsRepository, StoredSecretKey } from '@/application/secrets/SecretsRepository';
import { httpClient } from './httpClient';

// Секреты scope'аются по проекту: /api/projects/:projectId/secrets.
export class HttpSecretsRepository implements SecretsRepository {
  async put(projectId: string, key: string, value: string): Promise<void> {
    await httpClient.put<void>(`/projects/${encodeURIComponent(projectId)}/secrets`, { key, value });
  }
  async get(projectId: string, key: string): Promise<string> {
    const { value } = await httpClient.get<{ value: string }>(
      `/projects/${encodeURIComponent(projectId)}/secrets?key=${encodeURIComponent(key)}`,
    );
    return value;
  }
  async delete(projectId: string, key: string): Promise<void> {
    await httpClient.delete<void>(
      `/projects/${encodeURIComponent(projectId)}/secrets?key=${encodeURIComponent(key)}`,
    );
  }
  async list(projectId: string): Promise<StoredSecretKey[]> {
    const { secrets } = await httpClient.get<{
      secrets: { key: string; createdAt: string; updatedAt: string }[];
    }>(`/projects/${encodeURIComponent(projectId)}/secrets/list`);
    return secrets.map((s) => ({
      key: s.key,
      createdAt: new Date(s.createdAt),
      updatedAt: new Date(s.updatedAt),
    }));
  }
}
