import { effectivePlan, type Subscription } from '../../domain/usage/Subscription.js';
import type { Task } from '../../domain/task/Task.js';
import {
  TaskNotFoundError,
  TaskVersionLockedError,
  TaskVersionNotFoundError,
} from '../../domain/task/errors.js';
import type { ActivityRecorder } from '../activity/ActivityRecorder.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { TaskRepository } from './TaskRepository.js';
import type { TaskDelegationRepository } from './TaskDelegationRepository.js';
import type { TaskVersionRecorder } from './TaskVersionRecorder.js';
import type { TaskVersionRepository } from './TaskVersionRepository.js';
import { VERSION_HISTORY_FREE_DAYS } from './GetTaskVersions.js';
import { requireTaskModifyAccess } from './taskAuthorization.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly delegations: TaskDelegationRepository;
  readonly versions: TaskVersionRepository;
  readonly users: UserRepository;
  readonly now: () => Date;
  readonly activity?: ActivityRecorder;
  readonly versionRecorder?: TaskVersionRecorder;
};

export type RestoreTaskVersionCommand = {
  readonly projectId: string;
  readonly taskId: string;
  readonly versionId: string;
  readonly ownerUserId: string;
};

// Восстановление ВСЕЙ задачи к выбранной версии (как в Notion). Гейтинг: версии старше
// 7 дней доступны только на Прайм/ВИП. Сам restore тоже пишется новой версией.
export class RestoreTaskVersion {
  constructor(private readonly deps: Deps) {}

  async execute(input: RestoreTaskVersionCommand): Promise<Task> {
    await requireTaskModifyAccess(this.deps, input.projectId, input.taskId, input.ownerUserId, 'update_task');

    const version = await this.deps.versions.getById(input.versionId);
    if (!version || version.taskId !== input.taskId || version.projectId !== input.projectId) {
      throw new TaskVersionNotFoundError(input.versionId);
    }

    // Гейтинг по тарифу: старше 7 дней — только Прайм/ВИП.
    const now = this.deps.now();
    const sub: Subscription = (await this.deps.users.getSubscription(input.ownerUserId)) ?? {
      plan: 'free',
      startedAt: null,
      expiresAt: null,
    };
    const plan = effectivePlan(sub, now);
    const cutoffMs = now.getTime() - VERSION_HISTORY_FREE_DAYS * 24 * 60 * 60 * 1000;
    if (plan === 'free' && version.createdAt.getTime() < cutoffMs) {
      throw new TaskVersionLockedError();
    }

    const s = version.snapshot;
    const updated = await this.deps.tasks.update(input.taskId, {
      description: s.description,
      status: s.status,
      statusBeforeDone: s.statusBeforeDone,
      ralphMode: s.ralphMode,
      deadline: s.deadline,
      priority: s.priority,
    });
    if (!updated) throw new TaskNotFoundError(input.taskId);

    // Сам restore фиксируем: новая версия + событие в ленте.
    await this.deps.versionRecorder?.record(updated, input.ownerUserId);
    await this.deps.activity?.record({
      projectId: input.projectId,
      actorUserId: input.ownerUserId,
      kind: 'task_updated',
      payload: {
        taskId: updated.id,
        taskExcerpt: (updated.description ?? '').split('\n')[0]!.trim().slice(0, 80),
        changes: [{ field: 'restore', old: null, new: version.createdAt.toISOString() }],
      },
    });
    return updated;
  }
}
