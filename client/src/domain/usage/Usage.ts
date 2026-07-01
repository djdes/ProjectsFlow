// Клиентские типы usage/тарифа. 0 зависимостей. Зеркало серверного UsageSummary.
// Бюджет — в USD; ₽ — только отображение (через rubPerUsd).

export type PlanId = 'free' | 'prime' | 'vip';
export type WindowLabel = '5h' | '7d';

export type UsageWindow = {
  readonly label: WindowLabel;
  readonly spentUsd: number;
  readonly capUsd: number | null; // null = без лимита (free)
  readonly remainingUsd: number | null;
  readonly isOver: boolean;
  readonly resetsAt: Date | null;
};

export type Subscription = {
  readonly plan: PlanId;
  readonly startedAt: Date | null;
  readonly expiresAt: Date | null;
};

export type UsageSummary = {
  readonly plan: PlanId; // эффективный план (с учётом истечения)
  readonly subscription: Subscription;
  readonly fiveHour: UsageWindow;
  readonly sevenDay: UsageWindow;
  readonly isBlocked: boolean;
  readonly blockedWindow: WindowLabel | null;
  readonly rubPerUsd: number;
  // Доступен ли разовый пробный Прайм (1 час) — для лейбла кнопки в витрине.
  readonly primeTrialAvailable: boolean;
  // Админ/владелец — безлимитный доступ к диспетчеру (кнопки не гейтятся, баннер не давит).
  readonly isAdmin: boolean;
};

export function isFree(plan: PlanId): boolean {
  return plan === 'free';
}

// % использования окна (0..100). cap null/0 → 0 (без лимита — без шкалы).
export function windowPercentUsed(w: UsageWindow): number {
  if (w.capUsd == null || w.capUsd <= 0) return 0;
  return Math.min(100, Math.max(0, (w.spentUsd / w.capUsd) * 100));
}

// Порядок тарифов — для сравнения «апгрейд/даунгрейд».
export const PLAN_ORDER: Record<PlanId, number> = { free: 0, prime: 1, vip: 2 };
