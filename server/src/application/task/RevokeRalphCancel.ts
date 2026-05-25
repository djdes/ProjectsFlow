import { TaskNotFoundError } from '../../domain/task/errors.js';
import type { Task } from '../../domain/task/Task.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { TaskRepository } from './TaskRepository.js';

export class RalphCancelNotRequestedByYouError extends Error {
  constructor() {
    super('Only the user who requested the cancel (or admin) can revoke it');
    this.name = 'RalphCancelNotRequestedByYouError';
  }
}

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly users: UserRepository;
};

export type RevokeRalphCancelCommand = {
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly taskId: string;
};

// Юзер отзывает запрос на отмену (передумал). Можно если он сам же и запрашивал,
// либо если он системный админ. Если флаг уже сброшен — no-op (идемпотентно).
export class RevokeRalphCancel {
  constructor(private readonly deps: Deps) {}

  async execute(input: RevokeRalphCancelCommand): Promise<Task> {
    await requireProjectAccess(this.deps, input.projectId, input.ownerUserId, 'cancel_agent_job');

    const existing = await this.deps.tasks.getById(input.taskId);
    if (!existing || existing.projectId !== input.projectId) {
      throw new TaskNotFoundError(input.taskId);
    }
    if (existing.ralphCancelRequestedAt === null) {
      // Уже сброшено (Ralph ack-нул быстрее юзера, или дабл-клик) — no-op.
      return existing;
    }

    // Только автор запроса или системный админ может отозвать.
    if (existing.ralphCancelRequestedBy !== input.ownerUserId) {
      const me = await this.deps.users.getById(input.ownerUserId);
      if (!me?.isAdmin) throw new RalphCancelNotRequestedByYouError();
    }

    const updated = await this.deps.tasks.clearRalphCancel(input.taskId);
    if (!updated) throw new TaskNotFoundError(input.taskId);
    return updated;
  }
}
