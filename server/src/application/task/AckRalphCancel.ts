import { TaskNotFoundError } from '../../domain/task/errors.js';
import type { Task } from '../../domain/task/Task.js';
import type { TaskRepository } from './TaskRepository.js';

type Deps = {
  readonly tasks: TaskRepository;
};

export type AckRalphCancelCommand = {
  readonly projectId: string;
  readonly taskId: string;
};

// Ralph диспетчер отрапортовал: «обработал cancel» — сбрасываем флаг чтобы UI убрал
// pending-badge. Auth — bearer agent-token (применяется в routes middleware'е).
// Идемпотентно: повторный ack ничего не ломает.
export class AckRalphCancel {
  constructor(private readonly deps: Deps) {}

  async execute(input: AckRalphCancelCommand): Promise<Task> {
    const existing = await this.deps.tasks.getById(input.taskId);
    if (!existing || existing.projectId !== input.projectId) {
      throw new TaskNotFoundError(input.taskId);
    }
    const updated = await this.deps.tasks.clearRalphCancel(input.taskId);
    if (!updated) throw new TaskNotFoundError(input.taskId);
    return updated;
  }
}
