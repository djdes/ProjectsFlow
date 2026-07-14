import {
  InboxOwnerRequiredError,
  TargetProjectIsInboxError,
  TargetProjectNotFoundError,
  TaskNotFoundError,
} from '../../domain/task/errors.js';
import type { Task } from '../../domain/task/Task.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from './TaskRepository.js';

type Deps = {
  readonly tasks: TaskRepository;
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
};

// Перенос сохраняет ответственного, если он допустим в целевом проекте. Иначе задача
// атомарно переходит на caller'а — состояния без ответственного не бывает.
export class MoveTaskToProject {
  constructor(private readonly deps: Deps) {}

  async execute(taskId: string, targetProjectId: string, userId: string): Promise<Task> {
    const task = await this.deps.tasks.getById(taskId);
    if (!task) throw new TaskNotFoundError(taskId);

    const sourceProject = await this.deps.projects.getById(task.projectId);
    if (sourceProject?.isInbox) {
      if (sourceProject.ownerId !== userId) throw new InboxOwnerRequiredError();
    } else {
      await requireProjectAccess(this.deps, task.projectId, userId, 'move_task');
    }
    if (task.projectId === targetProjectId) return task;

    const targetProject = await this.deps.projects.getById(targetProjectId);
    if (!targetProject) throw new TargetProjectNotFoundError(targetProjectId);
    if (targetProject.isInbox) {
      if (targetProject.ownerId !== userId) throw new TargetProjectIsInboxError();
    } else {
      await requireProjectAccess(this.deps, targetProjectId, userId, 'create_task');
    }

    let assigneeUserId = task.assignee.userId;
    if (targetProject.isInbox) {
      if (assigneeUserId !== targetProject.ownerId) {
        const shared = await this.deps.members.listSharedUsers(targetProject.ownerId);
        if (!shared.some((member) => member.id === assigneeUserId)) assigneeUserId = userId;
      }
    } else {
      const membership = await this.deps.members.findForProject(targetProjectId, assigneeUserId);
      if (!membership) assigneeUserId = userId;
    }

    const moved = await this.deps.tasks.moveToProject(
      taskId,
      targetProjectId,
      assigneeUserId,
    );
    if (!moved) throw new TaskNotFoundError(taskId);
    return moved;
  }
}
