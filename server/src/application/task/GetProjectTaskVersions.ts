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
  // Общий проект (db/182): история скрытых правилами задач не отдаётся.
  readonly hiddenTaskIds?: (
    userId: string,
    refs: ReadonlyArray<{ readonly projectId: string; readonly taskId: string }>,
  ) => Promise<ReadonlySet<string>>;
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

    const all = await this.deps.versions.listForProject(projectId);
    const hidden = this.deps.hiddenTaskIds
      ? await this.deps.hiddenTaskIds(userId, all.map((v) => ({ projectId, taskId: v.taskId })))
      : new Set<string>();
    return {
      versions: hidden.size > 0 ? all.filter((v) => !hidden.has(v.taskId)) : all,
      plan,
      cutoffAt,
    };
  }
}
