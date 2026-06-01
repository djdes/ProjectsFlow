import { cn } from '@/lib/utils';
import type { ServerHealthStatus } from '@/domain/monitoring/Snapshot';
import type { AlertSeverity } from '@/domain/monitoring/Alert';

const STATUS_META: Record<ServerHealthStatus, { label: string; cls: string }> = {
  ok: { label: 'OK', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  degraded: { label: 'Внимание', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  down: { label: 'Недоступен', cls: 'bg-red-500/15 text-red-600 dark:text-red-400' },
  stale: { label: 'Устарел', cls: 'bg-muted text-muted-foreground' },
  unknown: { label: 'Нет данных', cls: 'bg-muted text-muted-foreground' },
};

const SEVERITY_META: Record<AlertSeverity, string> = {
  info: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  warning: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  critical: 'bg-red-500/15 text-red-600 dark:text-red-400',
};

function Pill({ className, children }: { className: string; children: React.ReactNode }): React.ReactElement {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', className)}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: ServerHealthStatus }): React.ReactElement {
  const meta = STATUS_META[status] ?? STATUS_META.unknown;
  return <Pill className={meta.cls}>{meta.label}</Pill>;
}

export function SeverityBadge({ severity }: { severity: AlertSeverity }): React.ReactElement {
  return <Pill className={SEVERITY_META[severity] ?? SEVERITY_META.info}>{severity}</Pill>;
}

export function PmStatusBadge({ status }: { status: string }): React.ReactElement {
  const ok = status === 'online';
  return (
    <Pill
      className={ok ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/15 text-red-600 dark:text-red-400'}
    >
      {status}
    </Pill>
  );
}
