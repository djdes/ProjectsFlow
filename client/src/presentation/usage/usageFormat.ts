import type { PlanId } from '@/domain/usage/Usage';

// Формат USD: $3.42; совсем мелочь — «<$0.01».
export function formatUsd(v: number): string {
  if (v > 0 && v < 0.01) return '<$0.01';
  return `$${v.toFixed(2)}`;
}

export function usdToRub(usd: number, rubPerUsd: number): number {
  return usd * rubPerUsd;
}

// Витринное «≈ 290 ₽» (бюджет считается в USD, ₽ — только для глаз).
export function formatRub(usd: number, rubPerUsd: number): string {
  const rub = Math.round(usdToRub(usd, rubPerUsd));
  return `≈ ${rub.toLocaleString('ru-RU')} ₽`;
}

// «до 30 июня, 14:05» — дата/время окончания подписки (локаль ru).
export function formatExpiry(d: Date): string {
  return d.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Строка срока подписки для профиля/диалога: «активен до 30 июня, 14:05 · затем Бесплатный».
// null для бесплатного/бессрочного (нечего показывать). plan — ЭФФЕКТИВНЫЙ план.
export function subscriptionExpiryNote(plan: PlanId, expiresAt: Date | null): string | null {
  if (plan === 'free' || !expiresAt) return null;
  return `активен до ${formatExpiry(expiresAt)} · затем Бесплатный`;
}

export function planNameRu(plan: PlanId): string {
  switch (plan) {
    case 'prime':
      return 'Прайм';
    case 'vip':
      return 'VIP';
    default:
      return 'Бесплатный';
  }
}

// «сбросится через 2 ч 14 мин» / «3 дн 4 ч» — относительный отсчёт до resetsAt окна.
export function resetCountdown(resetsAt: Date | null, now: Date = new Date()): string | null {
  if (!resetsAt) return null;
  const ms = resetsAt.getTime() - now.getTime();
  if (ms <= 0) return 'скоро сброс';
  const totalMin = Math.ceil(ms / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `сброс через ${days} дн${hours > 0 ? ` ${hours} ч` : ''}`;
  if (hours > 0) return `сброс через ${hours} ч${mins > 0 ? ` ${mins} мин` : ''}`;
  return `сброс через ${mins} мин`;
}
