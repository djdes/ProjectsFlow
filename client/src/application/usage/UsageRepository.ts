import type { PlanId, UsageSummary } from '@/domain/usage/Usage';

// Порт чтения usage и смены тарифа. Реализация — HttpUsageRepository.
export type UsageRepository = {
  getUsage(): Promise<UsageSummary>;
  // Self-serve смена плана; сервер возвращает свежий usage.
  changePlan(plan: PlanId): Promise<UsageSummary>;
};
