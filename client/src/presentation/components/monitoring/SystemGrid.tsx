import type { SystemSnapshot } from '@/domain/monitoring/Snapshot';
import { ResourceBar } from './ResourceBar';
import { fmtBytes, fmtDuration } from './format';

// Системные метрики: слева CPU/RAM/Swap/Load/Uptime/сеть, справа — диски.
export function SystemGrid({ system }: { system: SystemSnapshot }): React.ReactElement {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-2">
        {typeof system.cpuUsedPct === 'number' && (
          <ResourceBar
            label="CPU"
            pct={system.cpuUsedPct}
            sub={system.cpuCount ? `${system.cpuCount} ядер` : undefined}
          />
        )}
        <ResourceBar
          label="Память"
          pct={system.memUsedPct}
          sub={`${fmtBytes(system.memUsedBytes)} / ${fmtBytes(system.memTotalBytes)}`}
        />
        {typeof system.swapTotalBytes === 'number' && system.swapTotalBytes > 0 && (
          <ResourceBar
            label="Swap"
            pct={system.swapUsedPct ?? null}
            sub={`${fmtBytes(system.swapUsedBytes)} / ${fmtBytes(system.swapTotalBytes)}`}
          />
        )}
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Load average</span>
          <span className="font-medium tabular-nums">
            {system.load1 ?? '—'} / {system.load5 ?? '—'} / {system.load15 ?? '—'}
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Аптайм</span>
          <span className="font-medium tabular-nums">
            {system.uptimeSeconds === null ? '—' : fmtDuration(system.uptimeSeconds * 1000)}
          </span>
        </div>
        {(system.netRxBytes != null || system.processCount != null || system.openFds != null) && (
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            {system.netRxBytes != null && (
              <span>
                Сеть ↓{fmtBytes(system.netRxBytes)} ↑{fmtBytes(system.netTxBytes)}
              </span>
            )}
            {system.processCount != null && <span>процессов: {system.processCount}</span>}
            {system.openFds != null && <span>FD: {system.openFds}</span>}
          </div>
        )}
      </div>
      <div className="space-y-2">
        {system.disks.length > 0 ? (
          system.disks.map((d) => (
            <ResourceBar key={d.mount} label={`Диск ${d.mount}`} pct={d.usedPct} sub={fmtBytes(d.totalBytes)} />
          ))
        ) : (
          <p className="text-xs text-muted-foreground">Нет данных по дискам.</p>
        )}
      </div>
    </div>
  );
}
