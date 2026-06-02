import { TaskNotFoundError } from '../../domain/task/errors.js';
import type { TaskCommit } from '../../domain/task/TaskCommit.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireTaskReadAccess } from './taskAuthorization.js';
import type { TaskDelegationRepository } from './TaskDelegationRepository.js';
import type { TaskRepository } from './TaskRepository.js';
import type { TaskCommitRepository } from './TaskCommitRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly taskCommits: TaskCommitRepository;
  readonly delegations: TaskDelegationRepository;
};

export class ListTaskCommits {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, ownerUserId: string, taskId: string): Promise<TaskCommit[]> {
    await requireTaskReadAccess(this.deps, projectId, taskId, ownerUserId);
    const task = await this.deps.tasks.getById(taskId);
    if (!task || task.projectId !== projectId) throw new TaskNotFoundError(taskId);
    return this.deps.taskCommits.listByTask(taskId);
  }
}
