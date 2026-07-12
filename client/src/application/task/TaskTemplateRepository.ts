import type { TaskPriority, TaskStatus } from '@/domain/task/Task';
import type { TaskTemplate } from '@/domain/task/TaskTemplate';

// Шаблоны задач проекта (db/108). Read — участник, мутации — editor+ (гейтит сервер).
export interface TaskTemplateRepository {
  list(projectId: string): Promise<TaskTemplate[]>;
  create(
    projectId: string,
    input: {
      name: string;
      description: string;
      status?: TaskStatus;
      priority?: TaskPriority | null;
      icon?: string | null;
    },
  ): Promise<TaskTemplate>;
  remove(projectId: string, templateId: string): Promise<void>;
}
