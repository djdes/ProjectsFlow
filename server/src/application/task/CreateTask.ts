import { TaskDescriptionEmptyError } from '../../domain/task/errors.js';
import type { Task, TaskStatus } from '../../domain/task/Task.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { TaskRepository } from './TaskRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
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

    await requireProjectAccess(this.deps, input.projectId, input.ownerUserId, 'create_task');

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
