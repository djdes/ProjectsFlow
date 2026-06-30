import type { PlanId } from '../../domain/usage/Plan.js';
import { PRIME_TRIAL_MS } from '../../domain/usage/pricing.js';
import { PrimeTrialUsedError, VipNotSelfServeError } from '../../domain/usage/errors.js';
import type { UserRepository } from '../user/UserRepository.js';

type Deps = {
  readonly users: UserRepository;
  readonly now: () => Date;
};

// Self-serve смена плана (реального биллинга нет):
//   free  → сброс подписки (даты в null);
//   prime → РАЗОВЫЙ пробный 1 час (флаг prime_trial_used_at); повтор → 409;
//   vip   → запрещён self-serve (только админ-выдача) → 403.
export class BuyPlan {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string, plan: PlanId): Promise<void> {
    if (plan === 'free') {
      await this.deps.users.setPlan(userId, 'free', null, null);
      return;
    }
    if (plan === 'vip') {
      throw new VipNotSelfServeError();
    }
    // prime: разовый пробный час.
    const trialUsedAt = await this.deps.users.getPrimeTrialUsedAt(userId);
    if (trialUsedAt) throw new PrimeTrialUsedError();
    const now = this.deps.now();
    await this.deps.users.setPlan(userId, 'prime', now, new Date(now.getTime() + PRIME_TRIAL_MS));
    await this.deps.users.markPrimeTrialUsed(userId, now);
  }
}
