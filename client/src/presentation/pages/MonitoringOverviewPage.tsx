import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, BellRing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useContainer } from '@/infrastructure/di/container';
import type { OverviewProject } from '@/domain/monitoring/Server';
import { StatusBadge } from '@/presentation/components/monitoring/StatusBadge';
import { relativeTime } from '@/lib/relativeTime';

// Сводный дашборд «здоровье всех проектов» текущего юзера.
export function MonitoringOverviewPage(): React.ReactElement {
  const { monitoringRepository } = useContainer();
  const [projects, setProjects] = useState<OverviewProject[] | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      monitoringRepository
        .getOverview()
        .then((p) => {
          if (!cancelled) setProjects(p);
        })
        .catch((e: Error) => {
          if (!cancelled) setError(e);
        });
    };
    load();
    // Лёгкий polling раз в 30с (пауза на скрытой вкладке).
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) load();
    }, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [monitoringRepository]);

  const totalAlerts = (projects ?? []).reduce((sum, p) => sum + p.activeAlerts, 0);

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:gap-6 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="size-6" />
          <h1 className="text-3xl font-semibold tracking-tight">Мониторинг — все проекты</h1>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/monitoring/alerts">
            <BellRing className="size-4" />
            Алерты
            {totalAlerts > 0 && (
              <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-semibold text-white">
                {totalAlerts}
              </span>
            )}
          </Link>
        </Button>
      </div>

      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-red-600 dark:text-red-400">
            Не удалось загрузить сводку: {error.message}
          </CardContent>
        </Card>
      )}

      {projects === null ? (
        <div className="space-y-3">
          <div className="h-24 animate-pulse rounded-lg bg-muted" />
          <div className="h-24 animate-pulse rounded-lg bg-muted" />
        </div>
      ) : projects.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Ни в одном из ваших проектов пока нет серверов мониторинга. Откройте проект → вкладка
            «Мониторинг» → «Добавить сервер».
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link key={p.projectId} to={`/projects/${p.projectId}/monitoring`} className="block">
              <Card className="h-full transition-colors hover:border-foreground/30">
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                  <CardTitle className="truncate text-base">{p.projectName}</CardTitle>
                  {p.activeAlerts > 0 && (
                    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-semibold text-white">
                      {p.activeAlerts}
                    </span>
                  )}
                </CardHeader>
                <CardContent className="space-y-2">
                  {p.servers.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate">{s.name}</span>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {s.lastSnapshotAt ? relativeTime(s.lastSnapshotAt) : '—'}
                        </span>
                        <StatusBadge status={s.status} />
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
