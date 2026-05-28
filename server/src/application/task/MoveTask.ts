import { TaskNotFoundError } from '../../domain/task/errors.js';
import type { Task, TaskStatus } from '../../domain/task/Task.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from './TaskRepository.js';
import type { TaskDelegationRepository } from './TaskDelegationRepository.js';
import { requireTaskModifyAccess } from './taskAuthorization.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly delegations: TaskDelegationRepository;
};

// Клиент сообщает соседей в целевой колонке — сервер сам считает midpoint position.
// Это надёжнее чем доверять клиенту произвольное число (нет шанса dimension-collision при collab).
export type MoveTaskCommand = {
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly taskId: string;
  readonly targetStatus: TaskStatus;
  // ID карточки, которая должна оказаться ВЫШЕ перенесённой; null = вставить наверх.
  readonly beforeTaskId: string | null;
  // ID карточки, которая должна оказаться НИЖЕ перенесённой; null = вставить вниз.
  readonly afterTaskId: string | null;
};

const POSITION_STEP = 1024;

export class MoveTask {
  constructor(private readonly deps: Deps) {}

  async execute(input: MoveTaskCommand): Promise<Task> {
    await requireTaskModifyAccess(
      this.deps,
      input.projectId,
      input.taskId,
      input.ownerUserId,
      'move_task',
    );

    const task = await this.deps.tasks.getById(input.taskId);
    if (!task || task.projectId !== input.projectId) throw new TaskNotFoundError(input.taskId);

    const beforePos = await this.resolvePosition(input.beforeTaskId, input.projectId);
    const afterPos = await this.resolvePosition(input.afterTaskId, input.projectId);

    const newPosition = await this.computePosition(
      beforePos,
      afterPos,
      input.projectId,
      input.targetStatus,
    );

    const updated = await this.deps.tasks.update(input.taskId, {
      status: input.targetStatus,
      position: newPosition,
    });
    if (!updated) throw new TaskNotFoundError(input.taskId);
    return updated;
  }

  private async resolvePosition(taskId: string | null, projectId: string): Promise<number | null> {
    if (!taskId) return null;
    const t = await this.deps.tasks.getById(taskId);
    if (!t || t.projectId !== projectId) return null;
    return t.position;
  }

  private async computePosition(
    before: number | null,
    after: number | null,
    projectId: string,
    status: TaskStatus,
  ): Promise<number> {
    // Обе границы заданы → берём середину.
    if (before !== null && after !== null) return (before + after) / 2;
    // Только верхний сосед → кладём ниже него.
    if (before !== null) return before + POSITION_STEP;
    // Только нижний сосед → кладём выше него.
    if (after !== null) return after - POSITION_STEP;
    // Соседей нет — пустая колонка. Спросим bounds (на случай если карточку сами же двигаем).
    const bounds = await this.deps.tasks.getPositionBounds(projectId, status);
    return bounds ? bounds.max + POSITION_STEP : POSITION_STEP;
  }
}
