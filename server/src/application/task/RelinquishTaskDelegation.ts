import {
  DelegationNotFoundError,
  DelegationWrongStateError,
  NotDelegateError,
} from '../../domain/task/errors.js';
import type { TaskDelegationRepository } from './TaskDelegationRepository.js';

type Deps = {
  readonly delegations: TaskDelegationRepository;
};

// ДЕЛЕГАТ складывает с себя активную делегацию (drag карточки из блока делегирования на
// нижнюю доску «Входящих»): status → withdrawn, задача возвращается создателю. Зеркало
// WithdrawTaskDelegation, но с правом ДЕЛЕГАТА (withdraw — только создатель). Работает для
// pending («не буду принимать»), accepted («снимаю с себя») и pending_invite. Терминальные
// статусы — 409. Уведомление создателю не шлём: изменение видно в «Другим» по refetch;
// понадобится — добавить по образцу DeclineTaskDelegation.notifyResolved.
export class RelinquishTaskDelegation {
  constructor(private readonly deps: Deps) {}

  async execute(delegationId: string, userId: string): Promise<void> {
    const existing = await this.deps.delegations.getById(delegationId);
    if (!existing) throw new DelegationNotFoundError(delegationId);
    if (existing.delegateUserId !== userId) throw new NotDelegateError();
    if (
      existing.status !== 'pending' &&
      existing.status !== 'accepted' &&
      existing.status !== 'pending_invite'
    ) {
      throw new DelegationWrongStateError(existing.status, 'pending|accepted|pending_invite');
    }
    await this.deps.delegations.setStatus(delegationId, 'withdrawn');
  }
}
