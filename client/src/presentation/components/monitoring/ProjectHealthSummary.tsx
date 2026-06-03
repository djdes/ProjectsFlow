import { BellRing, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { relativeTime } from '@/lib/relativeTime';
import type { ServerWithLatest } from '@/domain/monitoring/Server';
import type { ServerAlert } from '@/domain/monitoring/Alert';
import type { ServerHealthStatus } from '@/domain/monitoring/Snapshot';
import { statusDotClass } from './health';
import type { RowDensity } from './ServerRow';

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} ${one}`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return `${n} ${few}`;
  return `${n} ${many}`;
}

function statusOf(item: ServerWithLatest): ServerHealthStatus {
  return item.latest?.status ?? item.server.lastStatus ?? 'unknown';
}

function StatusDot({ status, n }: { status: ServerHealthStatus; n: number }): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <span className={cn('size-2 rounded-full', statusDotClass(status))} />
      {n}
    </span>
  );
}

// Sticky-сводка «здоровье проекта»: агрегаты по серверам/алертам + кнопки управления + density-тумблер.
export function ProjectHealthSummary({
  servers,
  alerts,
  lastUpdated,
  canManage,
  density,
  onDensityChange,
  onAddServer,
  onOpenRules,
}: {
  servers: ServerWithLatest[];
  alerts: ServerAlert[];
  lastUpdated: Date | null;
  canManage: boolean;
  density: RowDensity;
  onDensityChange: (d: RowDensity) => void;
  onAddServer: () => void;
  onOpenRules: () => void;
}): React.ReactElement {
  const ok = servers.filter((s) => statusOf(s) === 'ok').length;
  const warn = servers.filter((s) => statusOf(s) === 'degraded').length;
  const down = servers.filter((s) => statusOf(s) === 'down').length;
  const noData = servers.length - ok - warn - down;
  const critical = alerts.filter((a) => a.severity === 'critical').length;

  return (
    <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-background/80 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6">
      <span className="text-sm font-medium">{plural(servers.length, 'сервер', 'сервера', 'серверов')}</span>
      {servers.length > 0 && (
        <span className="flex items-center gap-3 text-xs text-muted-foreground">
          <StatusDot status="ok" n={ok} />
          {warn > 0 && <StatusDot status="degraded" n={warn} />}
          {down > 0 && <StatusDot status="down" n={down} />}
          {noData > 0 && <StatusDot status="unknown" n={noData} />}
        </span>
      )}
      {alerts.length > 0 && (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
          🔴 {plural(alerts.length, 'алерт', 'алерта', 'алертов')}
          {critical > 0 && <span className="text-muted-foreground">({critical} critical)</span>}
        </span>
      )}
      {lastUpdated && (
        <span className="hidden text-xs text-muted-foreground sm:inline">обновлено {relativeTime(lastUpdated)}</span>
      )}

      <div className="ml-auto flex items-center gap-2">
        <div className="hidden items-center gap-0.5 rounded-md border bg-muted/50 p-0.5 lg:flex">
          {(['compact', 'detailed'] as RowDensity[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onDensityChange(d)}
              className={cn(
                'rounded px-2 py-0.5 text-xs font-medium transition-colors',
                density === d ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {d === 'compact' ? 'Компактно' : 'Подробно'}
            </button>
          ))}
        </div>
        {canManage && (
          <>
            <Button variant="outline" size="sm" onClick={onOpenRules}>
              <BellRing className="size-4" />
              <span className="hidden sm:inline">Настройки алертов</span>
            </Button>
            <Button size="sm" onClick={onAddServer}>
              <Plus className="size-4" />
              <span className="hidden sm:inline">Добавить сервер</span>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
