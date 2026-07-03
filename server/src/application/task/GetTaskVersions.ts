import { effectivePlan, type Subscription } from '../../domain/usage/Subscription.js';
import type { PlanId } from '../../domain/usage/Plan.js';
import type { TaskVersion } from '../../domain/task/TaskVersion.js';
import { TaskNotFoundError } from '../../domain/task/errors.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { TaskRepository } from './TaskRepository.js';
import type { TaskDelegationRepository } from './TaskDelegationRepository.js';
import type { TaskVersionRepository } from './TaskVersionRepository.js';
import { requireTaskModifyAccess } from './taskAuthorization.js';

// Бесплатный тариф видит историю версий не старше 7 дней; глубже — Прайм/ВИП.
export const VERSION_HISTORY_FREE_DAYS = 7;

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly delegations: TaskDelegationRepository;
  readonly versions: TaskVersionRepository;
  readonly users: UserRepository;
  readonly now: () => Date;
};

export type TaskVersionsResult = {
  readonly versions: readonly TaskVersion[];
  readonly plan: PlanId;
  // Версии старше этой даты недоступны на текущем тарифе (null = доступны все).
  readonly cutoffAt: string | null;
};

export class GetTaskVersions {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, taskId: string, ownerUserId: string): Promise<TaskVersionsResult> {
    await requireTaskModifyAccess(this.deps, projectId, taskId, ownerUserId, 'read_project');
    const task = await this.deps.tasks.getById(taskId);
    if (!task || task.projectId !== projectId) throw new TaskNotFoundError(taskId);

    const now = this.deps.now();
    const sub: Subscription = (await this.deps.users.getSubscription(ownerUserId)) ?? {
      plan: 'free',
      startedAt: null,
      expiresAt: null,
    };
    const plan = effectivePlan(sub, now);
    const cutoffAt =
      plan === 'free'
        ? new Date(now.getTime() - VERSION_HISTORY_FREE_DAYS * 24 * 60 * 60 * 1000).toISOString()
        : null;

    return { versions: await this.deps.versions.listForTask(taskId), plan, cutoffAt };
  }
}
