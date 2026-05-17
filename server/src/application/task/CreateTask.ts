import { ProjectNotFoundError } from '../../domain/project/errors.js';
import { TaskTitleEmptyError } from '../../domain/task/errors.js';
import type { Task, TaskStatus } from '../../domain/task/Task.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from './TaskRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly tasks: TaskRepository;
  readonly idGen: () => string;
};

export type CreateTaskCommand = {
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly title: string;
  readonly description: string | null;
  // По умолчанию новая карточка падает в TODO внизу столбца.
  readonly status: TaskStatus;
};

const POSITION_STEP = 1024;

export class CreateTask {
  constructor(private readonly deps: Deps) {}

  async execute(input: CreateTaskCommand): Promise<Task> {
    const title = input.title.trim();
    if (title.length === 0) throw new TaskTitleEmptyError();

    const project = await this.deps.projects.getByIdForOwner(input.projectId, input.ownerUserId);
    if (!project) throw new ProjectNotFoundError();

    // Кладём в самый низ колонки: position = max + STEP.
    const bounds = await this.deps.tasks.getPositionBounds(input.projectId, input.status);
    const position = bounds ? bounds.max + POSITION_STEP : POSITION_STEP;

    return this.deps.tasks.create({
      id: this.deps.idGen(),
      projectId: input.projectId,
      title,
      description: input.description?.trim() || null,
      status: input.status,
      position,
    });
  }
}
