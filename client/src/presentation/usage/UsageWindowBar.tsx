import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { windowPercentUsed, type UsageWindow } from '@/domain/usage/Usage';
import { formatRub, formatUsd, resetCountdown } from './usageFormat';

const LABELS: Record<UsageWindow['label'], string> = {
  '5h': 'За 5 часов',
  '7d': 'За неделю',
};

// Один ряд: заголовок окна + обратный отсчёт + полоска + суммы ($ и ≈₽).
export function UsageWindowBar({
  window: w,
  rubPerUsd,
}: {
  window: UsageWindow;
  rubPerUsd: number;
}): React.ReactElement {
  const free = w.capUsd == null;
  const pct = windowPercentUsed(w);
  const low =
    !free && w.capUsd != null && w.remainingUsd != null && w.remainingUsd <= w.capUsd * 0.1;
  const indicator = w.isOver ? 'bg-destructive' : low ? 'bg-amber-500' : 'bg-primary';
  const countdown = resetCountdown(w.resetsAt);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{LABELS[w.label]}</span>
        <span className="flex items-baseline gap-2 text-xs">
          {!free && (
            <span
              className={cn(
                'font-semibold tabular-nums',
                w.isOver ? 'text-destructive' : low ? 'text-amber-600 dark:text-amber-500' : 'text-foreground',
              )}
            >
              {Math.round(pct)}%
            </span>
          )}
          {countdown && <span className="text-muted-foreground">{countdown}</span>}
        </span>
      </div>
      {free ? (
        <>
          <Progress value={0} indicatorClassName="bg-muted-foreground/30" />
          <div className="text-xs text-muted-foreground">
            Без лимита — только метрика. Потрачено {formatUsd(w.spentUsd)}
          </div>
        </>
      ) : (
        <>
          <Progress value={pct} indicatorClassName={indicator} />
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className={cn('tabular-nums', w.isOver ? 'text-destructive' : 'text-muted-foreground')}>
              {formatUsd(w.spentUsd)} из {formatUsd(w.capUsd ?? 0)}
              {!w.isOver && w.remainingUsd != null && ` · осталось ${formatUsd(w.remainingUsd)}`}
              {w.isOver && ' · лимит исчерпан'}
            </span>
            <span className="shrink-0 text-muted-foreground/70">
              {formatRub(w.capUsd ?? 0, rubPerUsd)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
