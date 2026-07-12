import type { TaskPriority, TaskStatus } from '@/domain/task/Task';
import type { TaskTemplate } from '@/domain/task/TaskTemplate';
import type { TaskTemplateRepository } from '@/application/task/TaskTemplateRepository';
import { httpClient } from './httpClient';

type TemplateDto = {
  id: string;
  projectId: string;
  name: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority | null;
  icon: string | null;
  createdAt: string;
};

function fromDto(dto: TemplateDto): TaskTemplate {
  return { ...dto, createdAt: new Date(dto.createdAt) };
}

export class HttpTaskTemplateRepository implements TaskTemplateRepository {
  async list(projectId: string): Promise<TaskTemplate[]> {
    const res = await httpClient.get<{ templates: TemplateDto[] }>(
      `/projects/${projectId}/templates`,
    );
    return res.templates.map(fromDto);
  }

  async create(
    projectId: string,
    input: {
      name: string;
      description: string;
      status?: TaskStatus;
      priority?: TaskPriority | null;
      icon?: string | null;
    },
  ): Promise<TaskTemplate> {
    const res = await httpClient.post<{ template: TemplateDto }>(
      `/projects/${projectId}/templates`,
      input,
    );
    return fromDto(res.template);
  }

  async remove(projectId: string, templateId: string): Promise<void> {
    await httpClient.delete<void>(`/projects/${projectId}/templates/${templateId}`);
  }
}
