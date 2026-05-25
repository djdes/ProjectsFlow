import { TaskNotFoundError } from '../../domain/task/errors.js';
import type { Task } from '../../domain/task/Task.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { TaskRepository } from './TaskRepository.js';

// Сценарий когда отмена бессмысленна (см. spec §2):
//  - backlog/todo — worker ещё не взял задачу, никого убивать
//  - done       — задача уже завершена
// Только in_progress / awaiting_clarification имеют активного worker'а.
export class TaskNotActiveError extends Error {
  constructor(public readonly status: string) {
    super(`Task is not active (status=${status}); ralph-cancel only applies to in_progress / awaiting_clarification`);
    this.name = 'TaskNotActiveError';
  }
}

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
};

export type RequestRalphCancelCommand = {
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly taskId: string;
};

// Юзер запросил отмену Ralph-работы. Pull-based — ставим флаг в БД, Ralph его увидит
// при следующем poll'е (~5 с). Идемпотентно: повторный вызов — no-op.
export class RequestRalphCancel {
  constructor(private readonly deps: Deps) {}

  async execute(input: RequestRalphCancelCommand): Promise<Task> {
    // Используем cancel_agent_job — близкая семантика, та же editor-роль.
    await requireProjectAccess(this.deps, input.projectId, input.ownerUserId, 'cancel_agent_job');

    const existing = await this.deps.tasks.getById(input.taskId);
    if (!existing || existing.projectId !== input.projectId) {
      throw new TaskNotFoundError(input.taskId);
    }
    if (existing.status !== 'in_progress' && existing.status !== 'awaiting_clarification') {
      throw new TaskNotActiveError(existing.status);
    }

    // Repository — идемпотентно: UPDATE WHERE ralph_cancel_requested_at IS NULL.
    // Если уже установлено — оставляем как есть и просто возвращаем актуальное состояние.
    const updated = await this.deps.tasks.requestRalphCancel(input.taskId, input.ownerUserId);
    if (!updated) throw new TaskNotFoundError(input.taskId);
    return updated;
  }
}
