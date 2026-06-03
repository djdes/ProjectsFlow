import { cn } from '@/lib/utils';
import { barFillClass, pctTone } from './health';

// Лейбл + горизонтальный прогресс-бар. Цвет зависит от заполненности (warn/critical) — см. health.ts.
export function ResourceBar({
  label,
  pct,
  sub,
}: {
  label: string;
  pct: number | null;
  sub?: string;
}): React.ReactElement {
  const value = pct === null || !Number.isFinite(pct) ? null : Math.max(0, Math.min(100, pct));
  const color = barFillClass(pctTone(value));
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">
          {value === null ? '—' : `${Math.round(value)}%`}
          {sub ? <span className="ml-1 text-muted-foreground">{sub}</span> : null}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${value ?? 0}%` }} />
      </div>
    </div>
  );
}
