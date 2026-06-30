import type { PlanId, UsageSummary } from '@/domain/usage/Usage';
import type { UsageRepository } from './UsageRepository';

export class ChangePlan {
  constructor(private readonly repo: UsageRepository) {}

  execute(plan: PlanId): Promise<UsageSummary> {
    return this.repo.changePlan(plan);
  }
}
