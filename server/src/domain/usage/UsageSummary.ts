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
  // Доступен ли разовый пробный Прайм (1 час) — для лейбла кнопки в UI.
  readonly primeTrialAvailable: boolean;
  // Админ/владелец платформы — безлимитный доступ к диспетчеру (гейты его пропускают),
  // хотя расход всё равно метерится в ledger. Никогда не «заблокирован».
  readonly isAdmin: boolean;
};

export function buildUsageSummary(input: {
  readonly plan: PlanId;
  readonly subscription: Subscription;
  readonly fiveHour: UsageWindow;
  readonly sevenDay: UsageWindow;
  readonly primeTrialAvailable: boolean;
  readonly isAdmin: boolean;
}): UsageSummary {
  const { plan, subscription, fiveHour, sevenDay, primeTrialAvailable, isAdmin } = input;
  // 5ч приоритетнее в сообщении (короче ждать сброса), но блок = любое из окон.
  // Админ никогда не блокируется (безлимит), даже если формально окно исчерпано.
  const blockedWindow: WindowLabel | null = isAdmin
    ? null
    : fiveHour.isOver
      ? '5h'
      : sevenDay.isOver
        ? '7d'
        : null;
  return {
    plan,
    subscription,
    fiveHour,
    sevenDay,
    isBlocked: blockedWindow !== null,
    blockedWindow,
    primeTrialAvailable,
    isAdmin,
  };
}
