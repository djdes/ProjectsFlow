import { ProjectNotFoundError } from '../../domain/project/errors.js';
import { TaskNotFoundError } from '../../domain/task/errors.js';
import type { TaskCommit } from '../../domain/task/TaskCommit.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from './TaskRepository.js';
import type { TaskCommitRepository } from './TaskCommitRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly tasks: TaskRepository;
  readonly taskCommits: TaskCommitRepository;
};

export class ListTaskCommits {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, ownerUserId: string, taskId: string): Promise<TaskCommit[]> {
    const project = await this.deps.projects.getByIdForOwner(projectId, ownerUserId);
    if (!project) throw new ProjectNotFoundError();
    const task = await this.deps.tasks.getById(taskId);
    if (!task || task.projectId !== projectId) throw new TaskNotFoundError(taskId);
    return this.deps.taskCommits.listByTask(taskId);
  }
}
