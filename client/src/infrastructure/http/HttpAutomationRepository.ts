import type {
  AutomationRepository,
  SaveAutomationInput,
} from '@/application/automation/AutomationRepository';
import type { AutomationConfig } from '@/domain/automation/AutomationConfig';
import { httpClient } from './httpClient';

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
}
