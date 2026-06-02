import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Activity, BellRing, ChevronRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { relativeTime } from '@/lib/relativeTime';
import { useProject } from '@/presentation/hooks/useProject';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useMonitoring } from '@/presentation/hooks/useMonitoring';
import { ServerCard } from '@/presentation/components/monitoring/ServerCard';
import { AlertList } from '@/presentation/components/monitoring/AlertList';
import { AddServerDialog } from '@/presentation/components/monitoring/AddServerDialog';
import { AlertRulesDialog } from '@/presentation/components/monitoring/AlertRulesDialog';

export function MonitoringPage(): React.ReactElement {
  const { projectId } = useParams<{ projectId: string }>();
  const pid = projectId ?? '';
  const { data } = useProject(pid);
  const { user } = useCurrentUser();
  // Смотреть может любой участник; управлять (добавить/удалить/собрать) — editor+ или admin.
  const canManage = data?.role === 'editor' || data?.role === 'owner' || user?.isAdmin === true;
  const { servers, alerts, loading, error, forbidden, lastUpdated, reload } = useMonitoring(pid);
  const [addOpen, setAddOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:gap-6 sm:p-6">
      <nav className="flex items-center gap-1 text-sm text-muted-foreground" aria-label="Хлебные крошки">
        <Link to="/" className="hover:text-foreground">
          Проекты
        </Link>
        <ChevronRight className="size-4" />
        {data ? (
          <Link to={`/projects/${pid}`} className="hover:text-foreground">
            {data.name}
          </Link>
        ) : (
          <span>Проект</span>
        )}
        <ChevronRight className="size-4" />
        <span className="text-foreground">Мониторинг</span>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="size-6" />
          <h1 className="text-3xl font-semibold tracking-tight">Мониторинг</h1>
          {lastUpdated && (
            <span className="text-sm text-muted-foreground">обновлено {relativeTime(lastUpdated)}</span>
          )}
        </div>
        {!forbidden && canManage && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setRulesOpen(true)}>
              <BellRing className="size-4" />
              Настройки алертов
            </Button>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="size-4" />
              Добавить сервер
            </Button>
          </div>
        )}
      </div>

      {forbidden ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Мониторинг доступен участникам проекта.
          </CardContent>
        </Card>
      ) : (
        <>
          {error && (
            <Card>
              <CardContent className="py-4 text-sm text-red-600 dark:text-red-400">
                Не удалось загрузить данные мониторинга: {error.message}
              </CardContent>
            </Card>
          )}

          {alerts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Активные алерты</CardTitle>
              </CardHeader>
              <CardContent>
                <AlertList alerts={alerts} />
              </CardContent>
            </Card>
          )}

          {loading && !servers ? (
            <div className="space-y-3">
              <div className="h-32 animate-pulse rounded-lg bg-muted" />
              <div className="h-32 animate-pulse rounded-lg bg-muted" />
            </div>
          ) : servers && servers.length > 0 ? (
            <div className="grid gap-4">
              {servers.map((item) => (
                <ServerCard
                  key={item.server.id}
                  projectId={pid}
                  item={item}
                  canManage={canManage}
                  onChanged={reload}
                />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="space-y-3 py-10 text-center">
                <p className="text-muted-foreground">Серверов пока нет.</p>
                {canManage ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Добавьте «local» — хост самого ProjectsFlow (читается напрямую), либо «remote» —
                      удалённый сервер, метрики которого пушит агент-сборщик.
                    </p>
                    <Button size="sm" onClick={() => setAddOpen(true)}>
                      <Plus className="size-4" />
                      Добавить сервер
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Серверы добавляют участники с правами редактора.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      <AddServerDialog projectId={pid} open={addOpen} onOpenChange={setAddOpen} onCreated={reload} />
      <AlertRulesDialog projectId={pid} open={rulesOpen} onOpenChange={setRulesOpen} />
    </div>
  );
}
