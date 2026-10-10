import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, BellRing, CircleX, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingRegion, Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useContainer } from '@/infrastructure/di/container';
import type { OverviewProject } from '@/domain/monitoring/Server';
import { StatusBadge } from '@/presentation/components/monitoring/StatusBadge';
import { relativeTime } from '@/lib/relativeTime';
import { EmptyPanel, ErrorNote } from '@/presentation/pages/PageScaffold';
import { SectionPage } from '@/presentation/pages/SectionPage';

const STATUS_RANK: Record<string, number> = { down: 4, degraded: 3, stale: 2, unknown: 1, ok: 0 };
const SEV_RANK: Record<string, number> = { critical: 3, warning: 2, info: 1 };

function hasProblem(p: OverviewProject): boolean {
  return p.activeAlerts > 0 || p.worstStatus === 'down' || p.worstStatus === 'degraded';
}

// Счётчик алертов — красная пилюля (цвет = смысл «горит»).
const COUNT_BADGE_CLASS =
  'inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-semibold tabular-nums text-destructive-foreground';

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
    <SectionPage
      icon={Activity}
      label="Мониторинг"
      title="Мониторинг — все проекты"
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to="/monitoring/alerts">
            <BellRing className="size-4" />
            Алерты
            {totalAlerts > 0 && <span className={cn('ms-1', COUNT_BADGE_CLASS)}>{totalAlerts}</span>}
          </Link>
        </Button>
      }
    >
      {projects && projects.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-be pbe-3 text-sm">
          <span className="font-medium">{projects.length} проект(ов)</span>
          {problemCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-destructive">
              <TriangleAlert className="size-3.5" aria-hidden="true" />
              {problemCount} с проблемами
            </span>
          ) : (
            <span className="text-done">всё в норме</span>
          )}
          {serversDown > 0 && (
            <span className="inline-flex items-center gap-1.5 text-destructive">
              <CircleX className="size-3.5" aria-hidden="true" />
              {serversDown} down
            </span>
          )}
          {/* Чип-фильтр C4: рамка border, выбранный — мягкая синяя подложка. */}
          <button
            type="button"
            aria-pressed={onlyProblems}
            onClick={() => setOnlyProblems((v) => !v)}
            className={cn(
              'ms-auto inline-flex h-[26px] items-center rounded-md border px-2.5 text-meta font-medium transition-colors',
              onlyProblems
                ? 'border-primary bg-primary-soft text-primary-ink'
                : 'border-border text-muted-foreground hover:bg-hover hover:text-foreground',
            )}
          >
            {onlyProblems ? 'Показать все' : 'Только проблемные'}
          </button>
        </div>
      )}

      {error && <ErrorNote>Не удалось загрузить сводку: {error.message}</ErrorNote>}

      {projects === null ? (
        <LoadingRegion label="Загружаем сводку…" className="space-y-3">
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
        </LoadingRegion>
      ) : projects.length === 0 ? (
        <EmptyPanel>
          Ни в одном из ваших проектов пока нет серверов мониторинга. Откройте проект → вкладка
          «Мониторинг» → «Добавить сервер».
        </EmptyPanel>
      ) : view.length === 0 ? (
        <EmptyPanel>Проблемных проектов нет — всё спокойно.</EmptyPanel>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {view.map((p) => (
            <Link key={p.projectId} to={`/projects/${p.projectId}/monitoring`} className="block rounded-lg">
              {/* Контейнер нейтральный: худший статус — точкой у имени, а не цветной рамкой. */}
              <Card className="h-full transition-[box-shadow,background-color] hover:shadow-card-hover dark:hover:bg-card-hover">
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                  <CardTitle className="flex min-w-0 items-center gap-2 text-base">
                    {(p.worstStatus === 'down' || p.worstStatus === 'degraded') && (
                      <span
                        aria-hidden="true"
                        className={cn(
                          'size-2 shrink-0 rounded-full',
                          p.worstStatus === 'down' ? 'bg-destructive' : 'bg-warning',
                        )}
                      />
                    )}
                    <span className="truncate">{p.projectName}</span>
                  </CardTitle>
                  {p.activeAlerts > 0 && <span className={COUNT_BADGE_CLASS}>{p.activeAlerts}</span>}
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
    </SectionPage>
  );
}
