import {
  DelegationNotFoundError,
  DelegationWrongStateError,
  NotDelegateError,
} from '../../domain/task/errors.js';
import type { TaskDelegation } from '../../domain/task/TaskDelegation.js';
import type { TaskDelegationRepository } from './TaskDelegationRepository.js';
import type { TaskRepository } from './TaskRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { NotificationRepository } from '../notifications/NotificationRepository.js';
import type { EmailSender } from '../notifications/EmailSender.js';
import { renderDelegationDeclinedEmail } from '../notifications/emails/delegationDeclinedEmail.js';

type Deps = {
  readonly delegations: TaskDelegationRepository;
  readonly tasks: TaskRepository;
  readonly users: UserRepository;
  readonly notifications: NotificationRepository;
  readonly email: EmailSender;
  readonly idGen: () => string;
  readonly appUrl: string;
};

// Делегат отклоняет делегирование. Status pending → declined.
// Уведомляем создателя in-app + email (важная инфо — нужно перераспределить).
export class DeclineTaskDelegation {
  constructor(private readonly deps: Deps) {}

  async execute(delegationId: string, userId: string): Promise<TaskDelegation> {
    const existing = await this.deps.delegations.getById(delegationId);
    if (!existing) throw new DelegationNotFoundError(delegationId);
    if (existing.delegateUserId !== userId) throw new NotDelegateError();
    if (existing.status !== 'pending') {
      throw new DelegationWrongStateError(existing.status, 'pending');
    }

    const updated = await this.deps.delegations.setStatus(delegationId, 'declined');
    if (!updated) throw new DelegationNotFoundError(delegationId);

    void this.notifyResolved(updated).catch((err: unknown) => {
      console.error('[delegation:decline] notify failed:', err);
    });

    return updated;
  }

  private async notifyResolved(delegation: TaskDelegation): Promise<void> {
    const task = await this.deps.tasks.getById(delegation.taskId);
    const creator = await this.deps.users.getById(delegation.creatorUserId);
    const taskExcerpt = (task?.description ?? '').slice(0, 120);
    const inboxUrl = `${this.deps.appUrl.replace(/\/$/, '')}/inbox`;

    await this.deps.notifications.create({
      id: this.deps.idGen(),
      userId: delegation.creatorUserId,
      payload: {
        type: 'task_delegation_resolved',
        delegationId: delegation.id,
        taskId: delegation.taskId,
        taskExcerpt,
        resolution: 'declined',
        actorUserId: delegation.delegateUserId,
        actorDisplayName: delegation.delegateDisplayName,
      },
    });

    if (creator?.email) {
      const message = renderDelegationDeclinedEmail({
        to: creator.email,
        delegateDisplayName: delegation.delegateDisplayName,
        taskExcerpt,
        inboxUrl,
      });
      await this.deps.email.send(message);
    }
  }
}
