import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, BellRing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useContainer } from '@/infrastructure/di/container';
import type { OverviewProject } from '@/domain/monitoring/Server';
import { StatusBadge } from '@/presentation/components/monitoring/StatusBadge';
import { relativeTime } from '@/lib/relativeTime';

const STATUS_RANK: Record<string, number> = { down: 4, degraded: 3, stale: 2, unknown: 1, ok: 0 };
const SEV_RANK: Record<string, number> = { critical: 3, warning: 2, info: 1 };

function hasProblem(p: OverviewProject): boolean {
  return p.activeAlerts > 0 || p.worstStatus === 'down' || p.worstStatus === 'degraded';
}

// Сводный дашборд «здоровье всех проектов» текущего юзера.
export function MonitoringOverviewPage(): React.ReactElement {
  const { monitoringRepository } = useContainer();
  const [projects, setProjects] = useState<OverviewProject[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      monitoringRepository
        .getOverview()
        .then((p) => {
          if (!cancelled) {
            setProjects(p);
            // Сбрасываем ошибку при успехе (U6): иначе транзиентный сбой навсегда
            // оставлял красную карточку поверх живых данных на всех следующих поллах.
            setError(null);
          }
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
  const problemCount = (projects ?? []).filter(hasProblem).length;
  const serversDown = (projects ?? []).reduce(
    (n, p) => n + p.servers.filter((s) => s.status === 'down').length,
    0,
  );
  // Сортировка «где горит выше»: статус → severity → имя. + фильтр «только проблемные».
  const view = useMemo(() => {
    const list = (projects ?? []).filter((p) => !onlyProblems || hasProblem(p));
    return [...list].sort(
      (a, b) =>
        STATUS_RANK[b.worstStatus] - STATUS_RANK[a.worstStatus] ||
        (SEV_RANK[b.worstSeverity ?? ''] ?? 0) - (SEV_RANK[a.worstSeverity ?? ''] ?? 0) ||
        a.projectName.localeCompare(b.projectName),
    );
  }, [projects, onlyProblems]);

  return (
    <div className="flex h-full flex-col gap-5 p-4 pt-3.5 sm:p-6 sm:pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Activity className="size-5 text-primary" />
          <h1 className="text-xl font-semibold tracking-tight">Мониторинг — все проекты</h1>
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

      {projects && projects.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b pb-3 text-sm">
          <span className="font-medium">{projects.length} проект(ов)</span>
          {problemCount > 0 ? (
            <span className="text-red-600 dark:text-red-400">⚠ {problemCount} с проблемами</span>
          ) : (
            <span className="text-emerald-600 dark:text-emerald-400">всё в норме</span>
          )}
          {serversDown > 0 && (
            <span className="text-red-600 dark:text-red-400">✕ {serversDown} down</span>
          )}
          <button
            type="button"
            onClick={() => setOnlyProblems((v) => !v)}
            className={cn(
              'ml-auto rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
              onlyProblems ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {onlyProblems ? 'Показать все' : 'Только проблемные'}
          </button>
        </div>
      )}

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
      ) : view.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Проблемных проектов нет — всё спокойно. 🎉
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {view.map((p) => (
            <Link key={p.projectId} to={`/projects/${p.projectId}/monitoring`} className="block">
              <Card
                className={cn(
                  'h-full transition-colors hover:border-foreground/30',
                  p.worstStatus === 'down'
                    ? 'border-red-500/50'
                    : p.worstStatus === 'degraded'
                      ? 'border-amber-500/50'
                      : '',
                )}
              >
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
