export type WindowLabel = '5h' | '7d';

// Длительности скользящих окон (как у Opus): 5 часов и 7 дней.
export const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;
export const SEVEN_DAY_MS = 7 * 24 * 60 * 60 * 1000;

export type UsageWindow = {
  readonly label: WindowLabel;
  readonly spentUsd: number;
  readonly capUsd: number | null; // null = без лимита (free)
  readonly remainingUsd: number | null;
  readonly isOver: boolean;
  // Момент, когда самая ранняя ещё-учтённая трата выпадет из окна. null если без лимита / трат нет.
  readonly resetsAt: Date | null;
};

export function buildUsageWindow(input: {
  readonly label: WindowLabel;
  readonly spentUsd: number;
  readonly capUsd: number | null;
  readonly windowMs: number;
  readonly oldestSpendAt: Date | null;
  readonly now: Date;
}): UsageWindow {
  const { label, spentUsd, capUsd, windowMs, oldestSpendAt } = input;
  const remainingUsd = capUsd == null ? null : Math.max(0, capUsd - spentUsd);
  const isOver = capUsd != null && spentUsd >= capUsd;
  const resetsAt =
    capUsd == null || oldestSpendAt == null
      ? null
      : new Date(oldestSpendAt.getTime() + windowMs);
  return { label, spentUsd, capUsd, remainingUsd, isOver, resetsAt };
}
