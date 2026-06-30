import type { PlanId } from '../../domain/usage/Plan.js';
import type { UserRepository } from '../user/UserRepository.js';

type Deps = {
  readonly users: UserRepository;
  readonly now: () => Date;
};

// Self-serve «покупка»/смена плана (реального биллинга пока нет — флипает план + дату старта).
// free → сбрасывает подписку (даты в null). prime/vip → старт = сейчас, бессрочно (expiresAt null).
export class BuyPlan {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string, plan: PlanId): Promise<void> {
    if (plan === 'free') {
      await this.deps.users.setPlan(userId, 'free', null, null);
      return;
    }
    await this.deps.users.setPlan(userId, plan, this.deps.now(), null);
  }
}
