import { TaskDescriptionEmptyError, TaskNotFoundError } from '../../domain/task/errors.js';
import type { RalphMode, Task, TaskPriority } from '../../domain/task/Task.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository, UpdateTaskPatch } from './TaskRepository.js';
import type { TaskDelegationRepository } from './TaskDelegationRepository.js';
import { requireTaskModifyAccess } from './taskAuthorization.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly delegations: TaskDelegationRepository;
};

export type UpdateTaskCommand = {
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly taskId: string;
  readonly description: string | undefined;
  // Сменить режим Ralph можно в любой момент — диспетчер на следующем тике увидит.
  readonly ralphMode?: RalphMode;
  // null = очистить deadline; undefined = не менять.
  readonly deadline?: string | null;
  // null = убрать приоритет; undefined = не менять.
  readonly priority?: TaskPriority | null;
};

export class UpdateTask {
  constructor(private readonly deps: Deps) {}

  async execute(input: UpdateTaskCommand): Promise<Task> {
    await requireTaskModifyAccess(
      this.deps,
      input.projectId,
      input.taskId,
      input.ownerUserId,
      'update_task',
    );

    const existing = await this.deps.tasks.getById(input.taskId);
    if (!existing || existing.projectId !== input.projectId) throw new TaskNotFoundError(input.taskId);

    const patch: { -readonly [K in keyof UpdateTaskPatch]: UpdateTaskPatch[K] } = {};
    if (input.description !== undefined) {
      const trimmed = input.description.trim();
      if (trimmed.length === 0) throw new TaskDescriptionEmptyError();
      patch.description = trimmed;
    }
    if (input.ralphMode !== undefined) patch.ralphMode = input.ralphMode;
    if (input.deadline !== undefined) patch.deadline = input.deadline;
    if (input.priority !== undefined) patch.priority = input.priority;

    const updated = await this.deps.tasks.update(input.taskId, patch);
    if (!updated) throw new TaskNotFoundError(input.taskId);
    return updated;
  }
}
