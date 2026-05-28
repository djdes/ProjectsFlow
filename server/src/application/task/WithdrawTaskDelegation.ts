import {
  DelegationNotFoundError,
  DelegationWrongStateError,
  NotCreatorError,
} from '../../domain/task/errors.js';
import type { TaskDelegationRepository } from './TaskDelegationRepository.js';

type Deps = {
  readonly delegations: TaskDelegationRepository;
};

// Создатель отзывает pending-делегирование до accept'а. Status pending → withdrawn.
// Уведомление делегату не шлём — он ещё не действовал, всё незаметно.
export class WithdrawTaskDelegation {
  constructor(private readonly deps: Deps) {}

  async execute(delegationId: string, userId: string): Promise<void> {
    const existing = await this.deps.delegations.getById(delegationId);
    if (!existing) throw new DelegationNotFoundError(delegationId);
    if (existing.creatorUserId !== userId) throw new NotCreatorError();
    if (existing.status !== 'pending') {
      throw new DelegationWrongStateError(existing.status, 'pending');
    }
    await this.deps.delegations.setStatus(delegationId, 'withdrawn');
  }
}
