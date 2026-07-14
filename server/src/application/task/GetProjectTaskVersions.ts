import { effectivePlan, type Subscription } from '../../domain/usage/Subscription.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { UserRepository } from '../user/UserRepository.js';
import { VERSION_HISTORY_FREE_DAYS, type TaskVersionsResult } from './GetTaskVersions.js';
import type { TaskVersionRepository } from './TaskVersionRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly versions: TaskVersionRepository;
  readonly users: UserRepository;
  readonly now: () => Date;
};

// Общая история всех задач проекта. Доступна любому участнику с read_project;
// тарифный cutoff совпадает с историей отдельной задачи.
export class GetProjectTaskVersions {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, userId: string): Promise<TaskVersionsResult> {
    await requireProjectAccess(this.deps, projectId, userId, 'read_project');

    const now = this.deps.now();
    const sub: Subscription = (await this.deps.users.getSubscription(userId)) ?? {
      plan: 'free',
      startedAt: null,
      expiresAt: null,
    };
    const plan = effectivePlan(sub, now);
    const cutoffAt =
      plan === 'free'
        ? new Date(now.getTime() - VERSION_HISTORY_FREE_DAYS * 24 * 60 * 60 * 1000).toISOString()
        : null;

    return {
      versions: await this.deps.versions.listForProject(projectId),
      plan,
      cutoffAt,
    };
  }
}
