import type { PlanId } from './Plan.js';
import type { Subscription } from './Subscription.js';
import type { UsageWindow, WindowLabel } from './UsageWindow.js';

export type UsageSummary = {
  readonly plan: PlanId; // эффективный план (с учётом expiry)
  readonly subscription: Subscription;
  readonly fiveHour: UsageWindow;
  readonly sevenDay: UsageWindow;
  readonly isBlocked: boolean;
  readonly blockedWindow: WindowLabel | null;
};

export function buildUsageSummary(input: {
  readonly plan: PlanId;
  readonly subscription: Subscription;
  readonly fiveHour: UsageWindow;
  readonly sevenDay: UsageWindow;
}): UsageSummary {
  const { plan, subscription, fiveHour, sevenDay } = input;
  // 5ч приоритетнее в сообщении (короче ждать сброса), но блок = любое из окон.
  const blockedWindow: WindowLabel | null = fiveHour.isOver ? '5h' : sevenDay.isOver ? '7d' : null;
  return {
    plan,
    subscription,
    fiveHour,
    sevenDay,
    isBlocked: blockedWindow !== null,
    blockedWindow,
  };
}
