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

// ДЕЛЕГАТ складывает с себя активную делегацию (drag карточки из блока делегирования на
// нижнюю доску «Входящих»): status → withdrawn, задача возвращается создателю. Зеркало
// WithdrawTaskDelegation, но с правом ДЕЛЕГАТА (withdraw — только создатель). pending_invite
// сюда не относится: делегирование теперь мгновенное (accepted), pending/pending_invite
// больше не создаются (Task 11), поэтому guard пропускает только pending|accepted. После
// отмены accept/decline-флоу (спека §4) это ЕДИНСТВЕННЫЙ «отказ» делегата — поэтому
// создателю уходит уведомление task_delegation_resolved (resolution: declined) + email
// «снял(а) с себя задачу» (важная инфо — нужно перераспределить). Best-effort: сам
// relinquish не падает из-за уведомлений. Терминальные статусы (и pending_invite) — 409.
export class RelinquishTaskDelegation {
  constructor(private readonly deps: Deps) {}

  async execute(delegationId: string, userId: string): Promise<void> {
    const existing = await this.deps.delegations.getById(delegationId);
    if (!existing) throw new DelegationNotFoundError(delegationId);
    if (existing.delegateUserId !== userId) throw new NotDelegateError();
    if (existing.status !== 'pending' && existing.status !== 'accepted') {
      throw new DelegationWrongStateError(existing.status, 'pending|accepted');
    }
    const updated = await this.deps.delegations.setStatus(delegationId, 'withdrawn');

    void this.notifyResolved(updated ?? existing).catch((err: unknown) => {
      console.error('[delegation:relinquish] notify failed:', err);
    });
  }

  // Создателю: in-app task_delegation_resolved (declined, actor = делегат) + email.
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
