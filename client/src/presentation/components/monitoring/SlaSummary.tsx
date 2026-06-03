import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useMonitoringTrends } from '@/presentation/hooks/useMonitoringTrends';

// Аптайм = доля снимков со статусом 'ok' в окне. Источник — getHistory (status каждой точки),
// бэк не нужен. Берём 7-дневное окно (≈ предел в 2000 точек при 5-мин снимках), из него же 24ч.
function uptimePct(points: { collectedAt: Date; status: string }[], sinceMs: number): number | null {
  const win = points.filter((p) => p.collectedAt.getTime() >= sinceMs);
  if (win.length === 0) return null;
  const ok = win.filter((p) => p.status === 'ok').length;
  return (ok / win.length) * 100;
}

function pctClass(pct: number | null): string {
  if (pct === null) return 'text-muted-foreground';
  if (pct >= 99.5) return 'text-emerald-600 dark:text-emerald-400';
  if (pct >= 98) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function fmt(pct: number | null): string {
  return pct === null ? '—' : `${pct.toFixed(pct >= 99.95 ? 0 : 1)}%`;
}

// Компактная SLA-сводка: аптайм за 24ч и 7д (по доле ok-снимков).
export function SlaSummary({
  projectId,
  serverId,
  nowMs,
}: {
  projectId: string;
  serverId: string;
  nowMs: number;
}): React.ReactElement {
  const { points } = useMonitoringTrends(projectId, serverId, 168);
  const { d1, d7 } = useMemo(() => {
    const pts = points ?? [];
    return {
      d1: uptimePct(pts, nowMs - 24 * 3600 * 1000),
      d7: uptimePct(pts, nowMs - 168 * 3600 * 1000),
    };
  }, [points, nowMs]);

  return (
    <div className="flex items-center gap-4 text-xs">
      <span className="uppercase tracking-wide text-muted-foreground">Аптайм</span>
      <span className="flex items-center gap-1">
        <span className="text-muted-foreground">24ч</span>
        <span className={cn('font-medium tabular-nums', pctClass(d1))}>{fmt(d1)}</span>
      </span>
      <span className="flex items-center gap-1">
        <span className="text-muted-foreground">7д</span>
        <span className={cn('font-medium tabular-nums', pctClass(d7))}>{fmt(d7)}</span>
      </span>
    </div>
  );
}
