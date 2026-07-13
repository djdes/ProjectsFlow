import {
  DelegationNotFoundError,
  DelegationWrongStateError,
  NotCreatorError,
} from '../../domain/task/errors.js';
import type { TaskDelegationRepository } from './TaskDelegationRepository.js';

type Deps = {
  readonly delegations: TaskDelegationRepository;
};

// Создатель отзывает делегирование и ЗАБИРАЕТ задачу обратно себе. Работает для pending (отмена
// до accept'а) И для accepted («reclaim» — забрать уже принятую задачу): в обоих случаях активная
// делегация закрывается (status → withdrawn), задача возвращается к создателю. Терминальные
// статусы — 409.
export class WithdrawTaskDelegation {
  constructor(private readonly deps: Deps) {}

  async execute(delegationId: string, userId: string): Promise<void> {
    const existing = await this.deps.delegations.getById(delegationId);
    if (!existing) throw new DelegationNotFoundError(delegationId);
    if (existing.creatorUserId !== userId) throw new NotCreatorError();
    if (existing.status !== 'pending' && existing.status !== 'accepted') {
      throw new DelegationWrongStateError(existing.status, 'pending|accepted');
    }
    await this.deps.delegations.setStatus(delegationId, 'withdrawn');
  }
}
