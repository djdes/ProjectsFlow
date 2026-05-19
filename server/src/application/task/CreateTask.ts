import { ProjectNotFoundError } from '../../domain/project/errors.js';
import { TaskDescriptionEmptyError } from '../../domain/task/errors.js';
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
  readonly description: string;
  // По умолчанию новая карточка добавляется в TODO наверх столбца.
  readonly status: TaskStatus;
};

const POSITION_STEP = 1024;

export class CreateTask {
  constructor(private readonly deps: Deps) {}

  async execute(input: CreateTaskCommand): Promise<Task> {
    const description = input.description.trim();
    if (description.length === 0) throw new TaskDescriptionEmptyError();

    const project = await this.deps.projects.getByIdForOwner(input.projectId, input.ownerUserId);
    if (!project) throw new ProjectNotFoundError();

    // Кладём в самый верх колонки: position = min - STEP. Это даёт «свежее наверху»
    // в обоих UI-режимах (kanban и list — оба сортируют по position по возрастанию).
    const bounds = await this.deps.tasks.getPositionBounds(input.projectId, input.status);
    const position = bounds ? bounds.min - POSITION_STEP : POSITION_STEP;

    return this.deps.tasks.create({
      id: this.deps.idGen(),
      projectId: input.projectId,
      description,
      status: input.status,
      position,
    });
  }
}
