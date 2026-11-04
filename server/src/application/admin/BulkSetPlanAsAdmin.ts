import type { UserRepository } from '../user/UserRepository.js';
import type { AdminAuditInput, AdminAuditLog } from './AdminAuditLog.js';
import { subscriptionDetail } from './SetUserPlanAsAdmin.js';
import { AdminUserError } from '../../domain/user/adminErrors.js';
import { applyPlanTerm, isValidPlanTerm, type PlanTerm } from '../../domain/usage/planTerm.js';

type Deps = {
  readonly users: UserRepository;
  readonly audit: AdminAuditLog;
  readonly idGen: () => string;
  readonly now: () => Date;
};

export const BULK_PLAN_MAX_USERS = 500;

export type BulkPlanInput = {
  readonly userIds: readonly string[];
  readonly plan: 'prime' | 'vip';
  readonly term: PlanTerm;
};

export type BulkPlanResult = {
  readonly updated: number;
  // Accounts that are gone (deleted or never existed).
  readonly missing: readonly string[];
};

// «Выдать или продлить тариф» for the users selected in the console. Each account gets
// its own new term (see applyPlanTerm); one batch id ties the journal entries together.
export class BulkSetPlanAsAdmin {
  constructor(private readonly deps: Deps) {}

  async execute(input: BulkPlanInput, actorId: string): Promise<BulkPlanResult> {
    const ids = [...new Set(input.userIds)];
    const now = this.deps.now();
    if (ids.length === 0 || ids.length > BULK_PLAN_MAX_USERS) {
      throw new AdminUserError('invalid_user_data', `Выберите от 1 до ${BULK_PLAN_MAX_USERS} пользователей`);
    }
    if (!['prime', 'vip'].includes(input.plan) || !isValidPlanTerm(input.term, now)) {
      throw new AdminUserError('invalid_user_data', 'Укажите тариф и срок: от 1 до 3650 дней или дату в будущем до 19 января 2038 года');
    }
    const batchId = this.deps.idGen();
    const entries: AdminAuditInput[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      const current = await this.deps.users.getSubscription(id);
      if (!current) { missing.push(id); continue; }
      const next = applyPlanTerm(current, input.plan, input.term, now);
      await this.deps.users.setPlan(id, next.plan, next.startedAt, next.expiresAt);
      entries.push({
        actorUserId: actorId, targetUserId: id, action: 'bulk_plan', batchId,
        before: subscriptionDetail(current), after: { ...subscriptionDetail(next), batchSize: ids.length },
      });
    }
    await this.deps.audit.record(entries);
    return { updated: entries.length, missing };
  }
}
