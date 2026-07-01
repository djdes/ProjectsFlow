// Конфиг тарифов/стоимости — единственное место, где правятся числа.
// Бюджет считается и хранится в USD (= cost_usd от раннера). ₽ — только витрина/отображение.
// См. план gleaming-munching-locket.
import type { PlanId } from './Plan.js';

// Месячный USD-якорь ЛИМИТА плана (не цена подписки — цена в клиентском PlanCatalog).
// null = без лимита. Прайм $50, ВИП $100 — это 5000 / 10000 ₽ при RUB_PER_USD=100.
// Недельный (7д) лимит = месяц / 4; 5-часовой = недельный × FIVE_HOUR_FRACTION.
// Тюнится здесь ИЛИ через env (USAGE_{PRIME,VIP}_MONTHLY_USD, см. composition root).
export const PLAN_MONTHLY_USD: Record<PlanId, number | null> = {
  free: null,
  prime: 50,
  vip: 100,
};

// Доля 5-часового окна от недельного (недельный = месяц / 4). 0.4 — «как у Opus».
export const FIVE_HOUR_FRACTION = 0.4;

// Витринный курс ₽/$ для ОТОБРАЖЕНИЯ (не для расчётов — бюджет в USD). Тюнится.
export const RUB_PER_USD = 100;

// Длительность пробного Прайма (self-serve, разово) — 1 час.
export const PRIME_TRIAL_MS = 60 * 60 * 1000;
// Срок тарифа при выдаче админом — фикс месяц (30 дней).
export const ADMIN_GRANT_DAYS = 30;

// model → цена за 1M токенов (USD), input/output. Fallback-оценка, КОГДА раннер не прислал
// cost_usd. costUsd авторитетен, если есть. Заполнить актуальными ценами при необходимости.
export const MODEL_PRICE_PER_MTOK: Record<string, { readonly in: number; readonly out: number }> = {
  // 'claude-opus-4-8': { in: 15, out: 75 },
  // 'claude-sonnet-4-6': { in: 3, out: 15 },
};

// Оценка стоимости по токенам/модели. null, если модель неизвестна или токенов нет.
export function estimateCostUsd(
  model: string | null,
  tokensIn: number | null,
  tokensOut: number | null,
): number | null {
  if (!model) return null;
  const price = MODEL_PRICE_PER_MTOK[model];
  if (!price) return null;
  const ti = tokensIn ?? 0;
  const to = tokensOut ?? 0;
  if (ti === 0 && to === 0) return null;
  return (ti * price.in + to * price.out) / 1_000_000;
}
