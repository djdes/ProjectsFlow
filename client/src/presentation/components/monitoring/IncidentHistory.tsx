import { useEffect, useState } from 'react';
import { relativeTime } from '@/lib/relativeTime';
import { useContainer } from '@/infrastructure/di/container';
import type { ServerAlert } from '@/domain/monitoring/Alert';
import { SeverityBadge } from './StatusBadge';

// История инцидентов: показывает решённые (resolved) алерты проекта с длительностью.
export function IncidentHistory({ projectId }: { projectId: string }): React.ReactElement {
  const { monitoringRepository } = useContainer();
  const [items, setItems] = useState<ServerAlert[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    monitoringRepository
      .listAlerts(projectId, false)
      .then((all) => {
        if (!cancelled) setItems(all.filter((a) => a.status === 'resolved'));
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [monitoringRepository, projectId]);

  if (items === null) return <p className="text-sm text-muted-foreground">Загрузка…</p>;
  if (items.length === 0) return <p className="text-sm text-muted-foreground">Решённых инцидентов нет.</p>;

  return (
    <ul className="space-y-2">
      {items.map((a) => {
        const durationMin =
          a.resolvedAt && a.firstSeenAt
            ? Math.max(1, Math.round((a.resolvedAt.getTime() - a.firstSeenAt.getTime()) / 60000))
            : null;
        return (
          <li key={a.id} className="flex items-start gap-2 rounded-md border border-border/60 p-2.5 opacity-80">
            <SeverityBadge severity={a.severity} />
            <div className="min-w-0 flex-1">
              <p className="text-sm">{a.message}</p>
              <p className="text-xs text-muted-foreground">
                {a.ruleKind} · решён {a.resolvedAt ? relativeTime(a.resolvedAt) : '—'}
                {durationMin !== null ? ` · длился ~${durationMin} мин` : ''}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
