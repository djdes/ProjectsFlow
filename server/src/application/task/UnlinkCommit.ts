import { ProjectNotFoundError } from '../../domain/project/errors.js';
import { TaskCommitNotFoundError, TaskNotFoundError } from '../../domain/task/errors.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from './TaskRepository.js';
import type { TaskCommitRepository } from './TaskCommitRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly tasks: TaskRepository;
  readonly taskCommits: TaskCommitRepository;
};

export class UnlinkCommit {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, ownerUserId: string, taskId: string, sha: string): Promise<void> {
    const project = await this.deps.projects.getByIdForOwner(projectId, ownerUserId);
    if (!project) throw new ProjectNotFoundError();

    const task = await this.deps.tasks.getById(taskId);
    if (!task || task.projectId !== projectId) throw new TaskNotFoundError(taskId);

    const ok = await this.deps.taskCommits.unlink(taskId, sha);
    if (!ok) throw new TaskCommitNotFoundError(sha);
  }
}
