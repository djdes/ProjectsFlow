import { cn } from '@/lib/utils';
import type { Pm2ProcessSnapshot } from '@/domain/monitoring/Snapshot';
import { PmStatusBadge } from './StatusBadge';
import { fmtBytes, fmtDuration } from './format';
import { RECENT_RESTART_MS } from './health';

// Мобильный вид pm2: вертикальный card-list (вместо 6-колоночной таблицы с горизонтальным скроллом).
export function Pm2List({ pm2 }: { pm2: ReadonlyArray<Pm2ProcessSnapshot> }): React.ReactElement {
  if (pm2.length === 0) {
    return <p className="text-sm text-muted-foreground">Нет данных pm2.</p>;
  }
  return (
    <div className="space-y-2">
      {pm2.map((p) => {
        const recent = p.uptimeMs !== null && p.uptimeMs < RECENT_RESTART_MS;
        return (
          <div key={p.name} className="rounded-md border border-border/60 p-2.5">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium">{p.name}</span>
              <PmStatusBadge status={p.status} />
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Аптайм</span>
                <span className={cn('tabular-nums', recent && 'font-medium text-amber-600 dark:text-amber-400')}>
                  {fmtDuration(p.uptimeMs)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Рестарты</span>
                <span className="tabular-nums">{p.restarts ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">CPU</span>
                <span className="tabular-nums">{p.cpuPct === null ? '—' : `${p.cpuPct}%`}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Память</span>
                <span className="tabular-nums">{fmtBytes(p.memoryBytes)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
