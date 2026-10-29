import type { PlanId } from '../../domain/usage/Plan.js';
import { ADMIN_GRANT_DAYS } from '../../domain/usage/pricing.js';
import type { UserRepository } from '../user/UserRepository.js';
import { AdminUserError } from '../../domain/user/adminErrors.js';

type Deps = {
  readonly users: UserRepository;
  readonly now: () => Date;
};

// Omitted expiry keeps the legacy 30-day grant. Explicit null grants an unlimited plan.
export class SetUserPlanAsAdmin {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string, plan: PlanId, expiresAt?: Date | null): Promise<void> {
    const current = await this.deps.users.getSubscription(userId);
    if (!current) throw new AdminUserError('user_not_found', 'Пользователь не найден');
    if (!['free', 'prime', 'vip'].includes(plan)
      || (expiresAt instanceof Date && (!Number.isFinite(expiresAt.getTime())
        || expiresAt.getTime() < 1000 || expiresAt.getTime() > Date.parse('2038-01-19T03:14:07Z')))) {
      throw new AdminUserError('invalid_user_data', 'Укажите корректный тариф и дату до 19 января 2038 года');
    }
    if (plan === 'free') {
      await this.deps.users.setPlan(userId, 'free', null, null);
      return;
    }
    const now = this.deps.now();
    const expiry = expiresAt === undefined
      ? new Date(now.getTime() + ADMIN_GRANT_DAYS * 24 * 60 * 60 * 1000)
      : expiresAt;
    const startedAt = current.plan === plan ? (current.startedAt ?? now) : now;
    await this.deps.users.setPlan(userId, plan, startedAt, expiry);
  }
}
