import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, ChevronRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { useContainer } from '@/infrastructure/di/container';
import type { AlertCenter, AlertCenterEntry } from '@/domain/monitoring/Alert';
import { SeverityBadge } from '@/presentation/components/monitoring/StatusBadge';
import { relativeTime } from '@/lib/relativeTime';

function AlertRow({ a, resolved }: { a: AlertCenterEntry; resolved?: boolean }): React.ReactElement {
  return (
    <Link
      to={`/projects/${a.projectId}/monitoring`}
      className="flex items-start gap-3 rounded-md border border-border/60 p-3 transition-colors hover:border-foreground/30 hover:bg-muted/40"
    >
      <SeverityBadge severity={a.severity} />
      <div className="min-w-0 flex-1">
        <p className="text-sm">{a.message}</p>
        <p className="text-xs text-muted-foreground">
          {a.projectName}
          {a.serverName ? ` · ${a.serverName}` : ''} · {a.ruleKind} ·{' '}
          {resolved && a.resolvedAt
            ? `решён ${relativeTime(a.resolvedAt)}`
            : `с ${relativeTime(a.firstSeenAt)}`}
        </p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

// Кросс-проектный Alert Center: что горит прямо сейчас по всем проектам + недавно решённое.
export function AlertCenterPage(): React.ReactElement {
  const { monitoringRepository } = useContainer();
  const [data, setData] = useState<AlertCenter | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      monitoringRepository
        .getAlertCenter()
        .then((d) => {
          if (!cancelled) setData(d);
        })
        .catch((e: Error) => {
          if (!cancelled) setError(e);
        });
    };
    load();
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) load();
    }, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [monitoringRepository]);

  const critical = data?.active.filter((a) => a.severity === 'critical') ?? [];

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:gap-6 sm:p-6">
      <div className="flex items-center gap-2">
        <BellRing className="size-6" />
        <h1 className="text-2xl font-semibold tracking-tight">Алерты — все проекты</h1>
        {data && data.active.length > 0 && (
          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-sm font-semibold text-white">
            {data.active.length}
          </span>
        )}
      </div>
      <Link to="/monitoring" className="-mt-2 text-sm text-muted-foreground hover:text-foreground">
        ← Сводка по проектам
      </Link>

      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-red-600 dark:text-red-400">
            Не удалось загрузить алерты: {error.message}
          </CardContent>
        </Card>
      )}

      {data === null ? (
        <div className="space-y-2">
          <div className="h-14 animate-pulse rounded-lg bg-muted" />
          <div className="h-14 animate-pulse rounded-lg bg-muted" />
        </div>
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground">
              Активные{critical.length > 0 ? ` · ${critical.length} critical` : ''}
            </h2>
            {data.active.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  Активных алертов нет — всё спокойно. 🎉
                </CardContent>
              </Card>
            ) : (
              data.active.map((a) => <AlertRow key={a.id} a={a} />)
            )}
          </section>

          {data.recent.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-medium text-muted-foreground">Недавно решённые</h2>
              {data.recent.map((a) => (
                <div key={a.id} className="opacity-70">
                  <AlertRow a={a} resolved />
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
