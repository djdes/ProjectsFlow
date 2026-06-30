import type { PlanId } from '../../domain/usage/Plan.js';
import { ADMIN_GRANT_DAYS } from '../../domain/usage/pricing.js';
import type { UserRepository } from '../user/UserRepository.js';

type Deps = {
  readonly users: UserRepository;
  readonly now: () => Date;
};

// Админ-выдача тарифа конкретному юзеру. free → сброс подписки; prime/vip → фикс +30 дней
// (ADMIN_GRANT_DAYS). Это НЕ триал — флаг prime_trial_used_at не трогаем. По истечении срока
// effectivePlan лениво вернёт юзера на free (как и для self-serve). См. план gleaming-munching-locket.
export class SetUserPlanAsAdmin {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string, plan: PlanId): Promise<void> {
    if (plan === 'free') {
      await this.deps.users.setPlan(userId, 'free', null, null);
      return;
    }
    const now = this.deps.now();
    const expiresAt = new Date(now.getTime() + ADMIN_GRANT_DAYS * 24 * 60 * 60 * 1000);
    await this.deps.users.setPlan(userId, plan, now, expiresAt);
  }
}
