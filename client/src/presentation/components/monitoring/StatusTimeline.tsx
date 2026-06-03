import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { ServerHealthStatus } from '@/domain/monitoring/Snapshot';
import { useMonitoringTrends } from '@/presentation/hooks/useMonitoringTrends';
import { statusDotClass } from './health';

const BUCKETS = 48; // 24ч / 48 = 30 мин на сегмент
const WINDOW_MS = 24 * 3600 * 1000;

// Приоритет «худшести» статуса — для агрегации нескольких снимков в один сегмент.
const RANK: Record<string, number> = { down: 3, degraded: 2, stale: 1, ok: 0, unknown: 0 };

function fmtHM(d: Date): string {
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

// Полоса здоровья сервера за 24ч: 48 сегментов по 30 мин, цвет = худший статус снимков окна.
// Сразу показывает флапы/провалы «с одного взгляда». Данные — из готового getHistory (TrendPoint.status).
export function StatusTimeline({
  projectId,
  serverId,
  nowMs,
}: {
  projectId: string;
  serverId: string;
  // Передаём «сейчас» снаружи (Date.now() в render нельзя — react-hooks/purity).
  nowMs: number;
}): React.ReactElement {
  const { points, loading } = useMonitoringTrends(projectId, serverId, 24);

  const cells = useMemo(() => {
    const start = nowMs - WINDOW_MS;
    const bucketMs = WINDOW_MS / BUCKETS;
    const worst: (string | null)[] = Array.from({ length: BUCKETS }, () => null);
    for (const p of points ?? []) {
      const t = p.collectedAt.getTime();
      if (t < start || t > nowMs) continue;
      const idx = Math.min(BUCKETS - 1, Math.max(0, Math.floor((t - start) / bucketMs)));
      const cur = worst[idx];
      if (cur === null || (RANK[p.status] ?? 0) > (RANK[cur] ?? 0)) worst[idx] = p.status;
    }
    return worst.map((status, i) => {
      const from = new Date(start + i * bucketMs);
      const to = new Date(start + (i + 1) * bucketMs);
      const title = status
        ? `${fmtHM(from)}–${fmtHM(to)} · ${status}`
        : `${fmtHM(from)}–${fmtHM(to)} · нет данных`;
      const cls = status ? statusDotClass(status as ServerHealthStatus) : 'bg-muted';
      return { cls, title };
    });
  }, [points, nowMs]);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
        <span>Здоровье · 24ч</span>
        {loading && <span>загрузка…</span>}
      </div>
      <div className="flex h-2.5 gap-px overflow-hidden rounded">
        {cells.map((c, i) => (
          <div key={i} className={cn('flex-1', c.cls)} title={c.title} />
        ))}
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>24ч назад</span>
        <span>сейчас</span>
      </div>
    </div>
  );
}
