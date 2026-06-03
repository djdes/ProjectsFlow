import { useMemo } from 'react';
import { TrendingUp } from 'lucide-react';
import { useMonitoringTrends } from '@/presentation/hooks/useMonitoringTrends';
import { forecast } from './capacityMath';

const TARGET = 90; // % — порог, до которого прогнозируем

function fmtEta(days: number): string {
  if (days < 1) return '<1 дн';
  if (days < 60) return `~${Math.round(days)} дн`;
  return `~${Math.round(days / 30)} мес`;
}

// Прогноз исчерпания диска/памяти по 7-дневному тренду. Блок появляется ТОЛЬКО когда
// ресурс реально растёт (иначе скрыт — не шумим). Фронт-only, из getHistory.
export function CapacityForecast({
  projectId,
  serverId,
}: {
  projectId: string;
  serverId: string;
}): React.ReactElement | null {
  const { points } = useMonitoringTrends(projectId, serverId, 168);
  const disk = useMemo(
    () => forecast((points ?? []).map((p) => ({ collectedAt: p.collectedAt, value: p.diskUsedPct })), TARGET),
    [points],
  );
  const mem = useMemo(
    () => forecast((points ?? []).map((p) => ({ collectedAt: p.collectedAt, value: p.memUsedPct })), TARGET),
    [points],
  );

  if (!disk && !mem) return null;

  return (
    <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
      <h4 className="flex items-center gap-1.5 text-sm font-medium">
        <TrendingUp className="size-4 text-amber-600 dark:text-amber-400" />
        Прогноз нагрузки
      </h4>
      {disk && (
        <p className="text-xs text-muted-foreground">
          Диск достигнет {TARGET}% через{' '}
          <span className="font-medium text-foreground">{fmtEta(disk.etaDays)}</span> при текущем темпе
          (+{disk.ratePerDay.toFixed(1)}%/день, сейчас {Math.round(disk.last)}%)
        </p>
      )}
      {mem && (
        <p className="text-xs text-muted-foreground">
          Память достигнет {TARGET}% через{' '}
          <span className="font-medium text-foreground">{fmtEta(mem.etaDays)}</span> (+
          {mem.ratePerDay.toFixed(2)}%/день, сейчас {Math.round(mem.last)}%)
        </p>
      )}
    </div>
  );
}
