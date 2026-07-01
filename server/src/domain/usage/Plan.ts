import { FIVE_HOUR_FRACTION, PLAN_MONTHLY_USD } from './pricing.js';

export type PlanId = 'free' | 'prime' | 'vip';

export type WindowCaps = {
  readonly fiveHourUsd: number;
  readonly sevenDayUsd: number;
};

// Env-оверрайд кэпов (для тестов/тюнинга без деплоя). Парсится в composition root из
// USAGE_{PRIME,VIP}_{5H,7D}_USD и прокидывается сюда, чтобы домен не читал process.env.
export type PlanCapsOverride = Partial<Record<PlanId, Partial<WindowCaps>>>;

// Кэпы двух окон из месячного USD-якоря: недельный = месяц / 4, 5-часовой = недельный × доля.
// free → null (без лимита; доступ к диспетчеру у free всё равно закрыт гейтом).
// override перекрывает выведенные значения по-окну (для теста можно поставить $0.20/5ч).
export function planWindowCaps(plan: PlanId, override?: PlanCapsOverride): WindowCaps | null {
  const monthly = PLAN_MONTHLY_USD[plan];
  if (monthly == null) return null;
  const derivedSevenDay = monthly / 4;
  const o = override?.[plan];
  const sevenDayUsd = o?.sevenDayUsd ?? derivedSevenDay;
  const fiveHourUsd = o?.fiveHourUsd ?? derivedSevenDay * FIVE_HOUR_FRACTION;
  return { fiveHourUsd, sevenDayUsd };
}
