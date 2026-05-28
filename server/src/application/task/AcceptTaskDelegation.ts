import {
  DelegationNotFoundError,
  DelegationWrongStateError,
  NotDelegateError,
} from '../../domain/task/errors.js';
import type { TaskDelegation } from '../../domain/task/TaskDelegation.js';
import type { TaskDelegationRepository } from './TaskDelegationRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { NotificationRepository } from '../notifications/NotificationRepository.js';

type Deps = {
  readonly delegations: TaskDelegationRepository;
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
