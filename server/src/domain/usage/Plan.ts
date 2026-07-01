import { FIVE_HOUR_FRACTION, PLAN_MONTHLY_USD } from './pricing.js';

export type PlanId = 'free' | 'prime' | 'vip';

export type WindowCaps = {
  readonly fiveHourUsd: number;
  readonly sevenDayUsd: number;
};

// Env-оверрайд МЕСЯЧНОГО лимита плана в USD (для тестов/тюнинга без деплоя). Парсится в
// composition root из USAGE_{PRIME,VIP}_MONTHLY_USD; домен не читает process.env.
export type PlanMonthlyOverride = Partial<Record<PlanId, number>>;

// Кэпы двух окон из месячного USD-якоря: недельный (7д) = месяц / 4, 5-часовой = недельный × доля.
// free → null (без лимита; доступ к диспетчеру у free всё равно закрыт гейтом).
// monthlyOverride перекрывает месячный якорь (для теста можно поставить $2/мес → $0.5/7д, $0.2/5ч).
export function planWindowCaps(plan: PlanId, monthlyOverride?: PlanMonthlyOverride): WindowCaps | null {
  const monthly = monthlyOverride?.[plan] ?? PLAN_MONTHLY_USD[plan];
  if (monthly == null) return null;
  const sevenDayUsd = monthly / 4;
  const fiveHourUsd = sevenDayUsd * FIVE_HOUR_FRACTION;
  return { fiveHourUsd, sevenDayUsd };
}
