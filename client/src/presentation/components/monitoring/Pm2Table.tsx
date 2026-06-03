import { cn } from '@/lib/utils';
import type { Pm2ProcessSnapshot } from '@/domain/monitoring/Snapshot';
import { PmStatusBadge } from './StatusBadge';
import { fmtBytes, fmtDuration } from './format';
import { RECENT_RESTART_MS } from './health';

// Таблица процессов pm2. Недавно перезапущенные (аптайм < 10 мин) подсвечиваем — признак флапа.
export function Pm2Table({ pm2 }: { pm2: ReadonlyArray<Pm2ProcessSnapshot> }): React.ReactElement {
  if (pm2.length === 0) {
    return <p className="text-sm text-muted-foreground">Нет данных pm2.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="py-1 pr-3 font-medium">Процесс</th>
            <th className="py-1 pr-3 font-medium">Статус</th>
            <th className="py-1 pr-3 font-medium">Аптайм</th>
            <th className="py-1 pr-3 font-medium">Рестарты</th>
            <th className="py-1 pr-3 font-medium">CPU</th>
            <th className="py-1 font-medium">Память</th>
          </tr>
        </thead>
        <tbody>
          {pm2.map((p) => {
            const recent = p.uptimeMs !== null && p.uptimeMs < RECENT_RESTART_MS;
            return (
              <tr key={p.name} className="border-t border-border/40">
                <td className="py-1.5 pr-3 font-medium">{p.name}</td>
                <td className="py-1.5 pr-3">
                  <PmStatusBadge status={p.status} />
                </td>
                <td
                  className={cn(
                    'py-1.5 pr-3 tabular-nums',
                    recent && 'font-medium text-amber-600 dark:text-amber-400',
                  )}
                  title={recent ? 'Недавно перезапущен' : undefined}
                >
                  {fmtDuration(p.uptimeMs)}
                </td>
                <td className="py-1.5 pr-3 tabular-nums">{p.restarts ?? '—'}</td>
                <td className="py-1.5 pr-3 tabular-nums">{p.cpuPct === null ? '—' : `${p.cpuPct}%`}</td>
                <td className="py-1.5 tabular-nums">{fmtBytes(p.memoryBytes)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
