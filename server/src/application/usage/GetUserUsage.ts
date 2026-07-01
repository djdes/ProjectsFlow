import { planWindowCaps, type PlanCapsOverride } from '../../domain/usage/Plan.js';
import { effectivePlan, type Subscription } from '../../domain/usage/Subscription.js';
import {
  buildUsageWindow,
  FIVE_HOUR_MS,
  SEVEN_DAY_MS,
} from '../../domain/usage/UsageWindow.js';
import { buildUsageSummary, type UsageSummary } from '../../domain/usage/UsageSummary.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { UsageLedgerRepository } from './UsageLedgerRepository.js';

type Deps = {
  readonly ledger: UsageLedgerRepository;
  readonly users: UserRepository;
  readonly now: () => Date;
  // Env-оверрайд кэпов окон (для тестов/тюнинга). undefined → выведенные из PLAN_MONTHLY_USD.
  readonly capsOverride?: PlanCapsOverride;
};

// Считает usage по двум скользящим окнам (5ч / 7д) из append-only ledger. Кэпы — из
// эффективного плана (истёкший prime/vip → free). free → caps null → без блокировки.
export class GetUserUsage {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string): Promise<UsageSummary> {
    const now = this.deps.now();
    const [sub0, primeTrialUsedAt, user] = await Promise.all([
      this.deps.users.getSubscription(userId),
      this.deps.users.getPrimeTrialUsedAt(userId),
      this.deps.users.getById(userId),
    ]);
    const isAdmin = user?.isAdmin ?? false;
    const sub: Subscription = sub0 ?? {
      plan: 'free',
      startedAt: null,
      expiresAt: null,
    };
    const plan = effectivePlan(sub, now);
    const caps = planWindowCaps(plan, this.deps.capsOverride);

    const fiveHourSince = new Date(now.getTime() - FIVE_HOUR_MS);
    const sevenDaySince = new Date(now.getTime() - SEVEN_DAY_MS);
    const [spent5h, spent7d, oldest5h, oldest7d] = await Promise.all([
      this.deps.ledger.sumSince(userId, fiveHourSince),
      this.deps.ledger.sumSince(userId, sevenDaySince),
      this.deps.ledger.earliestSince(userId, fiveHourSince),
      this.deps.ledger.earliestSince(userId, sevenDaySince),
    ]);

    const fiveHour = buildUsageWindow({
      label: '5h',
      spentUsd: spent5h,
      capUsd: caps?.fiveHourUsd ?? null,
      windowMs: FIVE_HOUR_MS,
      oldestSpendAt: oldest5h,
      now,
    });
    const sevenDay = buildUsageWindow({
      label: '7d',
      spentUsd: spent7d,
      capUsd: caps?.sevenDayUsd ?? null,
      windowMs: SEVEN_DAY_MS,
      oldestSpendAt: oldest7d,
      now,
    });

    // summary.plan = эффективный (для кэпов/гейтов); subscription несёт реальный план + срок.
    return buildUsageSummary({
      plan,
      subscription: sub,
      fiveHour,
      sevenDay,
      primeTrialAvailable: primeTrialUsedAt == null,
      isAdmin,
    });
  }
}
