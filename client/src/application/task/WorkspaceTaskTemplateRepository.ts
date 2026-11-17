import type { TaskPriority, TaskType } from '@/domain/task/Task';
import type { TaskRecurrence } from '@/domain/task/TaskRecurrence';
import type { WorkspaceTaskTemplate } from '@/domain/task/WorkspaceTaskTemplate';

export type CreateWorkspaceTaskTemplateInput = {
  // Не задано — сервер возьмёт название задачи (первую строку текста).
  readonly name?: string | null;
  readonly description: string;
  readonly priority: TaskPriority | null;
  readonly taskType: TaskType | null;
  readonly recurrence: TaskRecurrence | null;
};

// Шаблоны задач пространства (db/187). Смотреть — участник, сохранять — не наблюдатель,
// удалять — автор, руководитель или владелец (гейтит сервер).
export interface WorkspaceTaskTemplateRepository {
  list(workspaceId: string): Promise<WorkspaceTaskTemplate[]>;
  create(workspaceId: string, input: CreateWorkspaceTaskTemplateInput): Promise<WorkspaceTaskTemplate>;
  remove(workspaceId: string, templateId: string): Promise<void>;
}
