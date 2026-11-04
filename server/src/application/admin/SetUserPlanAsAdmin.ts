import type { PlanId } from '../../domain/usage/Plan.js';
import { ADMIN_GRANT_DAYS } from '../../domain/usage/pricing.js';
import type { Subscription } from '../../domain/usage/Subscription.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { AdminAuditLog } from './AdminAuditLog.js';
import { AdminUserError } from '../../domain/user/adminErrors.js';

type Deps = {
  readonly users: UserRepository;
  readonly audit: AdminAuditLog;
  readonly now: () => Date;
};

export const subscriptionDetail = (s: Subscription): Record<string, unknown> => ({
  plan: s.plan,
  expiresAt: s.expiresAt ? s.expiresAt.toISOString() : null,
});

// Omitted expiry keeps the legacy 30-day grant. Explicit null grants an unlimited plan.
export class SetUserPlanAsAdmin {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string, plan: PlanId, expiresAt: Date | null | undefined, actorId: string): Promise<void> {
    const current = await this.deps.users.getSubscription(userId);
    if (!current) throw new AdminUserError('user_not_found', 'Пользователь не найден');
    if (!['free', 'prime', 'vip'].includes(plan)
      || (expiresAt instanceof Date && (!Number.isFinite(expiresAt.getTime())
        || expiresAt.getTime() < 1000 || expiresAt.getTime() > Date.parse('2038-01-19T03:14:07Z')))) {
      throw new AdminUserError('invalid_user_data', 'Укажите корректный тариф и дату до 19 января 2038 года');
    }
    let next: Subscription;
    if (plan === 'free') {
      next = { plan: 'free', startedAt: null, expiresAt: null };
    } else {
      const now = this.deps.now();
      const expiry = expiresAt === undefined
        ? new Date(now.getTime() + ADMIN_GRANT_DAYS * 24 * 60 * 60 * 1000)
        : expiresAt;
      next = { plan, startedAt: current.plan === plan ? (current.startedAt ?? now) : now, expiresAt: expiry };
    }
    await this.deps.users.setPlan(userId, next.plan, next.startedAt, next.expiresAt);
    await this.deps.audit.record([{
      actorUserId: actorId, targetUserId: userId, action: 'plan_change',
      before: subscriptionDetail(current), after: subscriptionDetail(next),
    }]);
  }
}
