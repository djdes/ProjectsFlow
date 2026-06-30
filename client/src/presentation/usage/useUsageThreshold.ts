import { isFree, type UsageSummary } from '@/domain/usage/Usage';

export type ThresholdLevel = 'none' | 'low' | 'blocked';

function iso(d: Date | null): string {
  return d ? d.toISOString() : '-';
}

// Уровень тревоги по остатку + «ключ эпизода» для re-arm баннера (см. UsageBanner).
// LOW = ≤5% недельного ИЛИ ≤10% 5-часового остатка. free → none (не лимитируется).
// Ключ кодирует level+plan+resetsAt'ы: окно сбросилось / эскалация low→blocked → ключ
// меняется → закрытый баннер появляется снова; перезагрузка с тем же ключом — остаётся скрытым.
export function computeThreshold(usage: UsageSummary | null): {
  level: ThresholdLevel;
  key: string;
} {
  if (!usage || isFree(usage.subscription.plan)) return { level: 'none', key: 'none' };

  if (usage.isBlocked) {
    return {
      level: 'blocked',
      key: `blocked|${usage.subscription.plan}|${iso(usage.fiveHour.resetsAt)}|${iso(usage.sevenDay.resetsAt)}`,
    };
  }

  const h = usage.fiveHour;
  const w = usage.sevenDay;
  const hourLow = h.capUsd != null && h.remainingUsd != null && h.remainingUsd <= h.capUsd * 0.1;
  const weeklyLow = w.capUsd != null && w.remainingUsd != null && w.remainingUsd <= w.capUsd * 0.05;
  if (hourLow || weeklyLow) {
    return {
      level: 'low',
      key: `low|${usage.subscription.plan}|${iso(h.resetsAt)}|${iso(w.resetsAt)}`,
    };
  }

  return { level: 'none', key: 'none' };
}
