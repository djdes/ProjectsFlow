import type {
  CreateWorkflowInput,
  UpdateWorkflowInput,
  WorkflowRepository,
  WorkflowRule,
} from '@/application/automation/WorkflowRepository';
import { httpClient } from './httpClient';

// Реализация порта WorkflowRepository поверх /api/projects/:id/workflows (срез 8).
// Серверные DTO 1:1 совпадают с доменными типами — трансформация не нужна.
export class HttpWorkflowRepository implements WorkflowRepository {
  async list(projectId: string): Promise<readonly WorkflowRule[]> {
    const res = await httpClient.get<{ workflows: readonly WorkflowRule[] }>(
      `/projects/${encodeURIComponent(projectId)}/workflows`,
    );
    return res.workflows;
  }

  async create(projectId: string, input: CreateWorkflowInput): Promise<WorkflowRule> {
    const res = await httpClient.post<{ workflow: WorkflowRule }>(
      `/projects/${encodeURIComponent(projectId)}/workflows`,
      input,
    );
    return res.workflow;
  }

  async update(
    projectId: string,
    id: string,
    patch: UpdateWorkflowInput,
  ): Promise<WorkflowRule> {
    const res = await httpClient.patch<{ workflow: WorkflowRule }>(
      `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(id)}`,
      patch,
    );
    return res.workflow;
  }

  async remove(projectId: string, id: string): Promise<void> {
    await httpClient.delete<void>(
      `/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(id)}`,
    );
  }
}
