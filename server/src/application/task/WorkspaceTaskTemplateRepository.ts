import type { WorkspaceTaskTemplate } from '../../domain/task/WorkspaceTaskTemplate.js';

export type CreateWorkspaceTaskTemplateInput = Omit<WorkspaceTaskTemplate, 'createdAt'>;

// Шаблоны задач пространства (db/187). Доступ проверяет use-case (ManageWorkspaceTaskTemplates).
export interface WorkspaceTaskTemplateRepository {
  // Свежие сверху.
  listByWorkspace(workspaceId: string): Promise<WorkspaceTaskTemplate[]>;
  getById(id: string): Promise<WorkspaceTaskTemplate | null>;
  create(input: CreateWorkspaceTaskTemplateInput): Promise<WorkspaceTaskTemplate>;
  delete(id: string): Promise<void>;
}
