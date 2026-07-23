import type {
  AutomationRepository,
  RunCommitSyncResult,
  SaveAutomationInput,
} from '@/application/automation/AutomationRepository';
import type { AutomationConfig } from '@/domain/automation/AutomationConfig';
import { httpClient } from './httpClient';
import { HttpError } from '@/lib/HttpError';

// Серверный DTO 1:1 совпадает с AutomationConfig — трансформация не нужна.
export class HttpAutomationRepository implements AutomationRepository {
  async get(projectId: string): Promise<AutomationConfig> {
    return httpClient.get<AutomationConfig>(
      `/projects/${encodeURIComponent(projectId)}/automation`,
    );
  }

  async save(projectId: string, input: SaveAutomationInput): Promise<AutomationConfig> {
    return httpClient.put<AutomationConfig>(
      `/projects/${encodeURIComponent(projectId)}/automation`,
      input,
    );
  }

  async runCommitSyncNow(projectId: string): Promise<RunCommitSyncResult> {
    try {
      return await httpClient.post<RunCommitSyncResult>(
        `/projects/${encodeURIComponent(projectId)}/commit-sync/run`,
        {},
      );
    } catch (error) {
      // 409 «уже идёт» и 422 «недоступно» — не сбои клиента, а осмысленные состояния кнопки:
      // сервер кладёт причину в тело, отдаём её как обычный результат.
      if (error instanceof HttpError && (error.status === 409 || error.status === 422)) {
        const status = (error.body as { status?: string }).status;
        if (status === 'already_running' || status === 'unavailable') return { status };
      }
      throw error;
    }
  }
}
