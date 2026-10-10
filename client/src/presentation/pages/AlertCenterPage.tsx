import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BellRing, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoadingRegion, Skeleton } from '@/components/ui/skeleton';
import { useContainer } from '@/infrastructure/di/container';
import type { AlertCenter, AlertCenterEntry } from '@/domain/monitoring/Alert';
import { SeverityBadge } from '@/presentation/components/monitoring/StatusBadge';
import { relativeTime } from '@/lib/relativeTime';
import { EmptyPanel, ErrorNote } from '@/presentation/pages/PageScaffold';
import { SectionPage } from '@/presentation/pages/SectionPage';

function AlertRow({ a, resolved }: { a: AlertCenterEntry; resolved?: boolean }): React.ReactElement {
  return (
    <Link
      to={`/projects/${a.projectId}/monitoring`}
      className="flex items-start gap-3 rounded-lg bg-card p-3 shadow-card transition-[box-shadow,background-color] hover:shadow-card-hover dark:hover:bg-card-hover"
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
          if (!cancelled) {
            setData(d);
            // Сброс ошибки при успехе (U6) — иначе красная карточка залипает навсегда.
            setError(null);
          }
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
    <SectionPage
      icon={BellRing}
      label="Алерты"
      title="Алерты — все проекты"
      titleAside={
        data && data.active.length > 0 ? (
          <span
            className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-semibold tabular-nums text-destructive-foreground"
            aria-label={`Активных алертов: ${data.active.length}`}
          >
            {data.active.length}
          </span>
        ) : null
      }
    >
      {/* Ссылка наверх, к сводке: в крошках раздела «Мониторинг» нет, путь назад — отсюда. */}
      <Button asChild variant="ghost" size="sm" className="-mbs-2 -ms-3 gap-1 self-start text-muted-foreground hover:text-foreground">
        <Link to="/monitoring">
          <ArrowLeft />
          Сводка по проектам
        </Link>
      </Button>

      {error && <ErrorNote>Не удалось загрузить алерты: {error.message}</ErrorNote>}

      {data === null ? (
        <LoadingRegion label="Загружаем алерты…" className="space-y-2">
          <Skeleton className="h-14 rounded-lg" />
          <Skeleton className="h-14 rounded-lg" />
        </LoadingRegion>
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-ui font-medium text-muted-foreground">
              Активные{critical.length > 0 ? ` · ${critical.length} critical` : ''}
            </h2>
            {data.active.length === 0 ? (
              <EmptyPanel>Активных алертов нет — всё спокойно.</EmptyPanel>
            ) : (
              data.active.map((a) => <AlertRow key={a.id} a={a} />)
            )}
          </section>

          {data.recent.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-ui font-medium text-muted-foreground">Недавно решённые</h2>
              {data.recent.map((a) => (
                <div key={a.id} className="opacity-70">
                  <AlertRow a={a} resolved />
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </SectionPage>
  );
}
