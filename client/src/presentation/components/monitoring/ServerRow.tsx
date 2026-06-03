import { ChevronRight, Server } from 'lucide-react';
import { cn } from '@/lib/utils';
import { relativeTime } from '@/lib/relativeTime';
import type { ServerWithLatest } from '@/domain/monitoring/Server';
import type { ServerAlert } from '@/domain/monitoring/Alert';
import { StatusBadge } from './StatusBadge';
import { metricTextClass, pctTone, severityChipClass, type HealthTone } from './health';

export type RowDensity = 'compact' | 'detailed';

function worstSeverity(alerts: ServerAlert[]): ServerAlert['severity'] {
  if (alerts.some((a) => a.severity === 'critical')) return 'critical';
  if (alerts.some((a) => a.severity === 'warning')) return 'warning';
  return 'info';
}

function Metric({ label, text, tone }: { label: string; text: string; tone: HealthTone }): React.ReactElement {
  return (
    <div className="flex w-14 flex-col items-end leading-tight">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={cn('text-xs font-medium tabular-nums', metricTextClass(tone))}>{text}</span>
    </div>
  );
}

// Компактная кликабельная строка сервера (уровень «обзор»). Детали — в ServerDetailSheet.
export function ServerRow({
  item,
  density,
  alerts,
  onOpen,
}: {
  item: ServerWithLatest;
  density: RowDensity;
  alerts: ServerAlert[];
  onOpen: () => void;
}): React.ReactElement {
  const { server, latest } = item;
  const status = latest?.status ?? server.lastStatus ?? 'unknown';
  const system = latest?.metrics?.system ?? null;
  const pm2 = latest?.metrics?.pm2 ?? [];
  const pm2Online = pm2.filter((p) => p.status === 'online').length;
  const worstDisk = system && system.disks.length > 0 ? Math.max(...system.disks.map((d) => d.usedPct)) : null;
  const cpuPct = system && typeof system.cpuUsedPct === 'number' ? system.cpuUsedPct : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-3 rounded-lg border border-border/60 bg-card px-3 py-2.5 text-left transition-colors hover:border-foreground/30 hover:bg-muted/40"
    >
      <Server className="size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-sm font-medium">{server.name}</span>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
          {server.kind}
        </span>
        <StatusBadge status={status} />
      </div>

      {density === 'detailed' && (
        <div className="hidden items-center gap-3 lg:flex">
          <Metric
            label="CPU"
            text={cpuPct !== null ? `${Math.round(cpuPct)}%` : system?.load1 != null ? `${system.load1}` : '—'}
            tone={cpuPct !== null ? pctTone(cpuPct) : 'idle'}
          />
          <Metric
            label="RAM"
            text={system?.memUsedPct != null ? `${Math.round(system.memUsedPct)}%` : '—'}
            tone={pctTone(system?.memUsedPct ?? null)}
          />
          <Metric
            label="Disk"
            text={worstDisk !== null ? `${Math.round(worstDisk)}%` : '—'}
            tone={pctTone(worstDisk)}
          />
          <Metric
            label="pm2"
            text={pm2.length > 0 ? `${pm2Online}/${pm2.length}` : '—'}
            tone={pm2.length === 0 ? 'idle' : pm2Online < pm2.length ? 'crit' : 'ok'}
          />
        </div>
      )}

      <div className="flex shrink-0 items-center gap-2">
        {alerts.length > 0 && (
          <span
            className={cn(
              'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold',
              severityChipClass(worstSeverity(alerts)),
            )}
            aria-label={`${alerts.length} активных алертов`}
          >
            {alerts.length}
          </span>
        )}
        <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
          {latest ? relativeTime(latest.collectedAt) : '—'}
        </span>
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
    </button>
  );
}
