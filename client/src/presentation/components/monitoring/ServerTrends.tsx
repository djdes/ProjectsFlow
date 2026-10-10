import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useMonitoringTrends } from '@/presentation/hooks/useMonitoringTrends';
import type { TrendPoint } from '@/domain/monitoring/Snapshot';
import { TrendChart } from './TrendChart';

const RANGES: { h: number; label: string }[] = [
  { h: 24, label: '24ч' },
  { h: 168, label: '7д' },
];

export function ServerTrends({
  projectId,
  serverId,
}: {
  projectId: string;
  serverId: string;
}): React.ReactElement {
  const [rangeH, setRangeH] = useState(24);
  const { points, loading } = useMonitoringTrends(projectId, serverId, rangeH);
  const series = (sel: (p: TrendPoint) => number | null): (number | null)[] =>
    (points ?? []).map(sel);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1">
        {RANGES.map((r) => (
          <button
            key={r.h}
            type="button"
            onClick={() => setRangeH(r.h)}
            className={cn(
              // Чип-фильтр C4: рамка-линия, выбранный — мягкий синий с синей рамкой.
              'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
              rangeH === r.h
                ? 'border-primary bg-primary-soft text-primary-ink'
                : 'border-border text-muted-foreground hover:bg-hover hover:text-foreground',
            )}
          >
            {r.label}
          </button>
        ))}
        {loading && <span className="text-xs text-muted-foreground">загрузка…</span>}
        {!loading && points && points.length === 0 && (
          <span className="text-xs text-muted-foreground">данных за период нет</span>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Серии — категории без смысла статуса, поэтому цвет — тон Notion (класс тона на
            обёртке задаёт --tone, график берёт его как цвет линии). */}
        <div className="pf-tone-blue">
          <TrendChart label="Память %" values={series((p) => p.memUsedPct)} max={100} suffix="%" color="var(--tone)" />
        </div>
        <div className="pf-tone-yellow">
          <TrendChart label="Диск %" values={series((p) => p.diskUsedPct)} max={100} suffix="%" color="var(--tone)" />
        </div>
        <div className="pf-tone-purple">
          <TrendChart label="Load (1m)" values={series((p) => p.cpuLoad1)} color="var(--tone)" />
        </div>
        <div className="pf-tone-red">
          <TrendChart label="Рестарты pm2" values={series((p) => p.pm2RestartTotal)} color="var(--tone)" />
        </div>
      </div>
    </div>
  );
}
