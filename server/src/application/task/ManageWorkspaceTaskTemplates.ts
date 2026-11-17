import { NotWorkspaceLeadError } from '../../domain/workspace/errors.js';
import type { WorkspaceMember } from '../../domain/workspace/WorkspaceMember.js';
import { TaskDescriptionEmptyError, TaskTemplateNotFoundError } from '../../domain/task/errors.js';
import type { TaskPriority, TaskType } from '../../domain/task/Task.js';
import type { TaskRecurrence } from '../../domain/task/TaskRecurrence.js';
import { resetChecklist } from '../../domain/task/checklist.js';
import {
  taskTemplateName,
  type WorkspaceTaskTemplate,
} from '../../domain/task/WorkspaceTaskTemplate.js';
import { requireWorkspaceEditor, requireWorkspaceMember } from '../workspace/workspaceAccess.js';
import type { WorkspaceTaskTemplateRepository } from './WorkspaceTaskTemplateRepository.js';

type Deps = {
  readonly templates: WorkspaceTaskTemplateRepository;
  readonly workspaces: {
    getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
  };
  readonly idGen: () => string;
};

export type CreateWorkspaceTaskTemplateCommand = {
  readonly workspaceId: string;
  readonly userId: string;
  // Не задано — имя из названия задачи (первая строка текста).
  readonly name?: string | null;
  readonly description: string;
  readonly priority: TaskPriority | null;
  readonly taskType: TaskType | null;
  readonly recurrence: TaskRecurrence | null;
};

/**
 * Шаблоны задач пространства (db/187).
 *
 * Смотреть и брать шаблоны может любой участник пространства. Сохранять — тот, кто может
 * заводить задачи (не наблюдатель). Удалять — автор шаблона, руководитель или владелец:
 * список общий, и чужую заготовку случайный участник убрать не должен.
 */
export class ManageWorkspaceTaskTemplates {
  constructor(private readonly deps: Deps) {}

  async list(workspaceId: string, userId: string): Promise<WorkspaceTaskTemplate[]> {
    await requireWorkspaceMember(this.deps.workspaces, workspaceId, userId);
    return this.deps.templates.listByWorkspace(workspaceId);
  }

  async create(input: CreateWorkspaceTaskTemplateCommand): Promise<WorkspaceTaskTemplate> {
    await requireWorkspaceEditor(this.deps.workspaces, input.workspaceId, input.userId);
    // Шаблон начинается с пустого чеклиста: отметки — состояние конкретной задачи.
    const description = resetChecklist(input.description).trim();
    if (description.length === 0) throw new TaskDescriptionEmptyError();
    return this.deps.templates.create({
      id: this.deps.idGen(),
      workspaceId: input.workspaceId,
      name: taskTemplateName(input.name, description),
      description,
      priority: input.priority,
      taskType: input.taskType,
      recurrence: input.recurrence,
      createdBy: input.userId,
    });
  }

  async remove(workspaceId: string, templateId: string, userId: string): Promise<void> {
    const member = await requireWorkspaceMember(this.deps.workspaces, workspaceId, userId);
    const template = await this.deps.templates.getById(templateId);
    // Чужое пространство из URL — как несуществующий шаблон (без IDOR и без утечки).
    if (!template || template.workspaceId !== workspaceId) throw new TaskTemplateNotFoundError();
    const manager = member.role === 'owner' || member.role === 'lead';
    if (!manager && template.createdBy !== userId) throw new NotWorkspaceLeadError();
    await this.deps.templates.delete(templateId);
  }
}
