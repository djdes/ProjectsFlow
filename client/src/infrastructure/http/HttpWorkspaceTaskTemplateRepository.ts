import type { WorkspaceTaskTemplate } from '@/domain/task/WorkspaceTaskTemplate';
import type {
  CreateWorkspaceTaskTemplateInput,
  WorkspaceTaskTemplateRepository,
} from '@/application/task/WorkspaceTaskTemplateRepository';
import { httpClient } from './httpClient';

type TemplateDto = Omit<WorkspaceTaskTemplate, 'createdAt'> & { createdAt: string };

function fromDto(dto: TemplateDto): WorkspaceTaskTemplate {
  return {
    ...dto,
    priority: dto.priority ?? null,
    taskType: dto.taskType ?? null,
    recurrence: dto.recurrence ?? null,
    createdBy: dto.createdBy ?? null,
    createdAt: new Date(dto.createdAt),
  };
}

export class HttpWorkspaceTaskTemplateRepository implements WorkspaceTaskTemplateRepository {
  async list(workspaceId: string): Promise<WorkspaceTaskTemplate[]> {
    const res = await httpClient.get<{ templates: TemplateDto[] }>(
      `/workspaces/${workspaceId}/task-templates`,
    );
    return res.templates.map(fromDto);
  }

  async create(
    workspaceId: string,
    input: CreateWorkspaceTaskTemplateInput,
  ): Promise<WorkspaceTaskTemplate> {
    const res = await httpClient.post<{ template: TemplateDto }>(
      `/workspaces/${workspaceId}/task-templates`,
      input,
    );
    return fromDto(res.template);
  }

  async remove(workspaceId: string, templateId: string): Promise<void> {
    await httpClient.delete<void>(`/workspaces/${workspaceId}/task-templates/${templateId}`);
  }
}
