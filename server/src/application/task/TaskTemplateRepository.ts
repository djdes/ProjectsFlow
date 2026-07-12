import type { TaskTemplate } from '../../domain/task/TaskTemplate.js';
import type { TaskPriority, TaskStatus } from '../../domain/task/Task.js';

export type CreateTaskTemplateInput = {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly description: string;
  readonly status: TaskStatus;
  readonly priority: TaskPriority | null;
  readonly icon: string | null;
  readonly createdBy: string | null;
};

// Шаблоны задач (db/108). Гейты доступа — в роутах (паттерн board_views):
// чтение — участник проекта, мутации — editor+.
export interface TaskTemplateRepository {
  listForProject(projectId: string): Promise<TaskTemplate[]>;
  getById(id: string): Promise<TaskTemplate | null>;
  create(input: CreateTaskTemplateInput): Promise<TaskTemplate>;
  delete(id: string): Promise<void>;
}
