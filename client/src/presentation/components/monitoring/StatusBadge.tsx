import { cn } from '@/lib/utils';
import type { ServerHealthStatus } from '@/domain/monitoring/Snapshot';
import type { AlertSeverity } from '@/domain/monitoring/Alert';
import { severityChipClass, statusTone, toneChipClass } from './health';

const STATUS_LABEL: Record<ServerHealthStatus, string> = {
  ok: 'OK',
  degraded: 'Внимание',
  down: 'Недоступен',
  stale: 'Устарел',
  unknown: 'Нет данных',
};

function Pill({ className, children }: { className: string; children: React.ReactNode }): React.ReactElement {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', className)}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: ServerHealthStatus }): React.ReactElement {
  return <Pill className={toneChipClass(statusTone(status))}>{STATUS_LABEL[status] ?? STATUS_LABEL.unknown}</Pill>;
}

export function SeverityBadge({ severity }: { severity: AlertSeverity }): React.ReactElement {
  return <Pill className={severityChipClass(severity)}>{severity}</Pill>;
}

export function PmStatusBadge({ status }: { status: string }): React.ReactElement {
  return <Pill className={toneChipClass(status === 'online' ? 'ok' : 'crit')}>{status}</Pill>;
}
