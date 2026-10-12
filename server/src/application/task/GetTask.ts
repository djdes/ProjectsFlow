import type { TaskAccessDeps } from './taskAuthorization.js';
import { requireTaskReadAccess, requireTaskModifyAccess, requireTaskTransferAccess } from './taskAuthorization.js';
import { ProjectNotFoundError, InsufficientProjectRoleError } from '../../domain/project/errors.js';
import { TaskNotFoundError } from '../../domain/task/errors.js';
import type { Task } from '../../domain/task/Task.js';

// Notification links read one authorized task, never the colleague's entire inbox.
export class GetTask {
  constructor(private readonly deps: TaskAccessDeps) {}
  async execute(projectId: string, userId: string, taskId: string): Promise<Task & { readonly canEdit: boolean; readonly canTransferProject: boolean; readonly context: { projectName: string; workspaceId: string; isInbox: boolean; canReadProject: boolean } }> {
    const { project } = await requireTaskReadAccess(this.deps, projectId, taskId, userId);
    const task = await this.deps.tasks.getById(taskId);
    if (!task || task.projectId !== projectId) throw new TaskNotFoundError(taskId);
    let canEdit = true;
    try { await requireTaskModifyAccess(this.deps, projectId, taskId, userId, 'update_task'); }
    catch (error) {
      if (!(error instanceof ProjectNotFoundError) && !(error instanceof InsufficientProjectRoleError)) throw error;
      canEdit = false;
    }
    let canTransferProject = false;
    if (canEdit) {
      try {
        await requireTaskTransferAccess(this.deps, projectId, taskId, userId);
        canTransferProject = true;
      } catch (error) {
        if (!(error instanceof ProjectNotFoundError) && !(error instanceof InsufficientProjectRoleError)) throw error;
      }
    }
    return { ...task, canEdit, canTransferProject, context: { projectName: project.name, workspaceId: project.workspaceId, isInbox: project.isInbox, canReadProject: !project.isInbox || project.ownerId === userId } };
  }
}
