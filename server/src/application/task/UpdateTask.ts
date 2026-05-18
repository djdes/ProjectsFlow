import { ProjectNotFoundError } from '../../domain/project/errors.js';
import { TaskDescriptionEmptyError, TaskNotFoundError } from '../../domain/task/errors.js';
import type { Task } from '../../domain/task/Task.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository, UpdateTaskPatch } from './TaskRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly tasks: TaskRepository;
};

export type UpdateTaskCommand = {
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly taskId: string;
  readonly description: string | undefined;
};

export class UpdateTask {
  constructor(private readonly deps: Deps) {}

  async execute(input: UpdateTaskCommand): Promise<Task> {
    const project = await this.deps.projects.getByIdForOwner(input.projectId, input.ownerUserId);
    if (!project) throw new ProjectNotFoundError();

    const existing = await this.deps.tasks.getById(input.taskId);
    if (!existing || existing.projectId !== input.projectId) throw new TaskNotFoundError(input.taskId);

    const patch: { -readonly [K in keyof UpdateTaskPatch]: UpdateTaskPatch[K] } = {};
    if (input.description !== undefined) {
      const trimmed = input.description.trim();
      if (trimmed.length === 0) throw new TaskDescriptionEmptyError();
      patch.description = trimmed;
    }

    const updated = await this.deps.tasks.update(input.taskId, patch);
    if (!updated) throw new TaskNotFoundError(input.taskId);
    return updated;
  }
}
