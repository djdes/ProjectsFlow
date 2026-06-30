import { FIVE_HOUR_FRACTION, PLAN_MONTHLY_USD } from './pricing.js';

export type PlanId = 'free' | 'prime' | 'vip';

export type WindowCaps = {
  readonly fiveHourUsd: number;
  readonly sevenDayUsd: number;
};

// Кэпы двух окон из месячного USD-якоря: недельный = месяц / 4, 5-часовой = недельный × доля.
// free → null (без лимита). Единственное место формулы кэпов.
export function planWindowCaps(plan: PlanId): WindowCaps | null {
  const monthly = PLAN_MONTHLY_USD[plan];
  if (monthly == null) return null;
  const sevenDayUsd = monthly / 4;
  const fiveHourUsd = sevenDayUsd * FIVE_HOUR_FRACTION;
  return { fiveHourUsd, sevenDayUsd };
}
