import { relativeTime } from '@/lib/relativeTime';
import type { ServerAlert } from '@/domain/monitoring/Alert';
import { SeverityBadge } from './StatusBadge';

export function AlertList({ alerts }: { alerts: ServerAlert[] }): React.ReactElement {
  if (alerts.length === 0) {
    return <p className="text-sm text-muted-foreground">Активных алертов нет.</p>;
  }
  return (
    <ul className="space-y-2">
      {alerts.map((a) => (
        <li key={a.id} className="flex items-start gap-2 rounded-md border border-border/60 p-2.5">
          <SeverityBadge severity={a.severity} />
          <div className="min-w-0 flex-1">
            <p className="text-sm">{a.message}</p>
            <p className="text-xs text-muted-foreground">
              с {relativeTime(a.firstSeenAt)} · {a.ruleKind}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
