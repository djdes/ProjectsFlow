import { TaskNotFoundError } from '../../domain/task/errors.js';
import type { TaskAttachment } from '../../domain/task/TaskAttachment.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireTaskReadAccess } from './taskAuthorization.js';
import type { TaskRepository } from './TaskRepository.js';
import type { TaskAttachmentRepository } from './TaskAttachmentRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly attachments: TaskAttachmentRepository;
};

export class ListTaskAttachments {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, ownerUserId: string, taskId: string): Promise<TaskAttachment[]> {
    await requireTaskReadAccess(this.deps, projectId, taskId, ownerUserId);
    const task = await this.deps.tasks.getById(taskId);
    if (!task || task.projectId !== projectId) throw new TaskNotFoundError(taskId);
    return this.deps.attachments.listByTask(taskId);
  }
}
