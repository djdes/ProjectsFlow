import {
  DelegationNotFoundError,
  DelegationWrongStateError,
  NotDelegateError,
} from '../../domain/task/errors.js';
import type { TaskDelegation } from '../../domain/task/TaskDelegation.js';
import type { TaskDelegationRepository } from './TaskDelegationRepository.js';
import type { TaskRepository } from './TaskRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { NotificationRepository } from '../notifications/NotificationRepository.js';

type Deps = {
  readonly delegations: TaskDelegationRepository;
  readonly tasks: TaskRepository;
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly users: UserRepository;
  readonly notifications: NotificationRepository;
  readonly idGen: () => string;
};

// Делегат принимает делегирование. Status pending → accepted.
// Уведомляем создателя in-app (без email — статус виден в UI сразу).
export class AcceptTaskDelegation {
  constructor(private readonly deps: Deps) {}

  async execute(delegationId: string, userId: string): Promise<TaskDelegation> {
    const existing = await this.deps.delegations.getById(delegationId);
    if (!existing) throw new DelegationNotFoundError(delegationId);
    if (existing.delegateUserId !== userId) throw new NotDelegateError();
    if (existing.status !== 'pending') {
      throw new DelegationWrongStateError(existing.status, 'pending');
    }

    const updated = await this.deps.delegations.setStatus(delegationId, 'accepted');
    if (!updated) throw new DelegationNotFoundError(delegationId);

    // Принял делегированную задачу в именованном проекте → помечаем проект favorite'ом
    // для делегата, чтобы он всплыл в «Избранном» сайдбара как активная работа. best-effort:
    // принятие не должно падать, если пометка не удалась. Inbox-задачи пропускаем — общего
    // проекта нет (делегат не член инбокса, инбокс favorite'ить нельзя).
    try {
      const task = await this.deps.tasks.getById(updated.taskId);
      if (task) {
        const project = await this.deps.projects.getById(task.projectId);
        if (project && !project.isInbox) {
          await this.deps.members.setFavorite(project.id, userId, true);
        }
      }
    } catch (err: unknown) {
      console.error('[delegation:accept] auto-favorite failed:', err);
    }

    void this.notifyResolved(updated).catch((err: unknown) => {
      console.error('[delegation:accept] notify failed:', err);
    });

    return updated;
  }

  private async notifyResolved(delegation: TaskDelegation): Promise<void> {
    // creator user — извлекаем для taskExcerpt'а нужна задача; делегат — для actorDisplayName.
    // delegation уже содержит delegateDisplayName + creatorUserId, всё что нужно.
    await this.deps.notifications.create({
      id: this.deps.idGen(),
      userId: delegation.creatorUserId,
      payload: {
        type: 'task_delegation_resolved',
        delegationId: delegation.id,
        taskId: delegation.taskId,
        // taskExcerpt оставляем пустым в этом payload'е — UI его не показывает
        // (для resolved-notification важен сам факт + кто). Если потребуется — добавим
        // join в DrizzleTaskDelegationRepository.
        taskExcerpt: '',
        resolution: 'accepted',
        actorUserId: delegation.delegateUserId,
        actorDisplayName: delegation.delegateDisplayName,
      },
    });
  }
}
