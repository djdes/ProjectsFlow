import { ProjectNotFoundError } from '../../domain/project/errors.js';
import type { Task } from '../../domain/task/Task.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from './TaskRepository.js';
import type { TaskCommitRepository } from './TaskCommitRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly tasks: TaskRepository;
  readonly taskCommits: TaskCommitRepository;
};

export type TaskWithCommitCount = Task & { readonly commitCount: number };

export class ListTasks {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, ownerUserId: string): Promise<TaskWithCommitCount[]> {
    const project = await this.deps.projects.getByIdForOwner(projectId, ownerUserId);
    if (!project) throw new ProjectNotFoundError();
    const tasks = await this.deps.tasks.listByProject(projectId);
    const counts = await this.deps.taskCommits.countsByTasks(tasks.map((t) => t.id));
    return tasks.map((t) => ({ ...t, commitCount: counts.get(t.id) ?? 0 }));
  }
}
