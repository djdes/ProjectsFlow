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

// model → цена за 1M токенов (USD): input / cached input / output. Fallback-оценка, КОГДА
// раннер не прислал cost_usd. costUsd авторитетен, если есть.
// GPT — стандартный тариф API OpenAI (developers.openai.com/api/docs/pricing, 06.10.2026):
// на подписке ChatGPT маржинальная цена 0, а лимиты тарифов считаются «API-эквивалентом».
export const MODEL_PRICE_PER_MTOK: Record<
  string,
  { readonly in: number; readonly cachedIn?: number; readonly out: number }
> = {
  'gpt-6-astra': { in: 10, cachedIn: 1, out: 50 },
  'gpt-6.1-sol': { in: 2, cachedIn: 0.1, out: 10 },
  'gpt-6-sol': { in: 2, cachedIn: 0.2, out: 10 },
  'gpt-6-luna': { in: 0.1, cachedIn: 0.01, out: 0.5 },
  'gpt-5.6-sol': { in: 4, cachedIn: 0.4, out: 20 },
  'gpt-5.6-terra': { in: 2, cachedIn: 0.2, out: 12 },
  'gpt-5.6-luna': { in: 0.2, cachedIn: 0.02, out: 1.2 },
  'gpt-5.5': { in: 5, cachedIn: 0.5, out: 30 },
  'gpt-5.4': { in: 2.5, cachedIn: 0.25, out: 15 },
  'gpt-5.4-mini': { in: 0.75, cachedIn: 0.075, out: 4.5 },
  'gpt-5.3-codex': { in: 1.75, cachedIn: 0.175, out: 14 },
};

// Оценка стоимости по токенам/модели. null, если модель неизвестна или токенов нет.
export function estimateCostUsd(
  model: string | null,
  tokensIn: number | null,
  tokensOut: number | null,
): number | null {
  return estimateCostUsdDetailed(model, { tokensIn, cachedTokensIn: null, tokensOut });
}

// То же с учётом кэшированного ввода: cachedTokensIn — часть tokensIn, оплачиваемая по
// цене cached input (так считают и OpenAI, и codex: cached ⊂ input).
export function estimateCostUsdDetailed(
  model: string | null,
  usage: {
    readonly tokensIn: number | null;
    readonly cachedTokensIn: number | null;
    readonly tokensOut: number | null;
  },
): number | null {
  if (!model) return null;
  const price = MODEL_PRICE_PER_MTOK[model];
  if (!price) return null;
  const ti = usage.tokensIn ?? 0;
  const to = usage.tokensOut ?? 0;
  if (ti === 0 && to === 0) return null;
  const cached = Math.min(Math.max(usage.cachedTokensIn ?? 0, 0), ti);
  const cachedPrice = price.cachedIn ?? price.in;
  return ((ti - cached) * price.in + cached * cachedPrice + to * price.out) / 1_000_000;
}
