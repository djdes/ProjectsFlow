import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Activity, ChevronRight, Plus } from 'lucide-react';
import { ProjectBreadcrumbs } from '@/presentation/layout/ProjectBreadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useProject } from '@/presentation/hooks/useProject';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useMonitoring } from '@/presentation/hooks/useMonitoring';
import { ServerRow, type RowDensity } from '@/presentation/components/monitoring/ServerRow';
import { ServerDetailSheet } from '@/presentation/components/monitoring/ServerDetailSheet';
import { ProjectHealthSummary } from '@/presentation/components/monitoring/ProjectHealthSummary';
import { AlertList } from '@/presentation/components/monitoring/AlertList';
import { AddServerDialog } from '@/presentation/components/monitoring/AddServerDialog';
import { AlertRulesDialog } from '@/presentation/components/monitoring/AlertRulesDialog';
import { IncidentHistory } from '@/presentation/components/monitoring/IncidentHistory';

const DENSITY_KEY = 'pf:monitoring:density';

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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [density, setDensity] = useState<RowDensity>('detailed');

  // Плотность строк — персистим (как тему). Читаем из localStorage в эффекте (не в render).
  useEffect(() => {
    const v = localStorage.getItem(DENSITY_KEY);
    if (v === 'compact' || v === 'detailed') setDensity(v);
  }, []);
  const changeDensity = (d: RowDensity): void => {
    setDensity(d);
    localStorage.setItem(DENSITY_KEY, d);
  };

  const openItem = servers?.find((s) => s.server.id === openId) ?? null;
  const alertsFor = (serverId: string): typeof alerts => alerts.filter((a) => a.serverId === serverId);

  return (
    <div className="flex h-full flex-col gap-5 p-4 pt-3.5 sm:p-6 sm:pt-4">
      <ProjectBreadcrumbs
        projectId={pid ?? ''}
        projectName={data?.name ?? 'Проект'}
        projectIcon={data?.icon}
        view="monitoring"
      />

      <div className="flex items-center gap-2">
        <Activity className="size-5 text-primary" />
        <h1 className="text-xl font-semibold tracking-tight">Мониторинг</h1>
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

          {servers && servers.length > 0 && (
            <ProjectHealthSummary
              servers={servers}
              alerts={alerts}
              lastUpdated={lastUpdated}
              canManage={canManage}
              density={density}
              onDensityChange={changeDensity}
              onAddServer={() => setAddOpen(true)}
              onOpenRules={() => setRulesOpen(true)}
            />
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
            <div className="space-y-2">
              <div className="h-16 animate-pulse rounded-lg bg-muted" />
              <div className="h-16 animate-pulse rounded-lg bg-muted" />
            </div>
          ) : servers && servers.length > 0 ? (
            <div className="grid grid-cols-1 gap-2 2xl:grid-cols-2">
              {servers.map((item) => (
                <ServerRow
                  key={item.server.id}
                  item={item}
                  density={density}
                  alerts={alertsFor(item.server.id)}
                  onOpen={() => setOpenId(item.server.id)}
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
                  <p className="text-sm text-muted-foreground">Серверы добавляют участники с правами редактора.</p>
                )}
              </CardContent>
            </Card>
          )}

          {servers && servers.length > 0 && (
            <Card>
              <CardHeader>
                <button
                  type="button"
                  onClick={() => setHistoryOpen((v) => !v)}
                  className="flex items-center gap-1 text-left text-base font-semibold hover:text-foreground"
                >
                  <ChevronRight
                    className={historyOpen ? 'size-4 rotate-90 transition-transform' : 'size-4 transition-transform'}
                  />
                  История инцидентов
                </button>
              </CardHeader>
              {historyOpen && (
                <CardContent>
                  <IncidentHistory projectId={pid} />
                </CardContent>
              )}
            </Card>
          )}
        </>
      )}

      <ServerDetailSheet
        projectId={pid}
        item={openItem}
        alerts={openItem ? alertsFor(openItem.server.id) : []}
        open={openId !== null}
        onOpenChange={(o) => {
          if (!o) setOpenId(null);
        }}
        canManage={canManage}
        onChanged={reload}
      />
      <AddServerDialog projectId={pid} open={addOpen} onOpenChange={setAddOpen} onSaved={reload} />
      <AlertRulesDialog projectId={pid} open={rulesOpen} onOpenChange={setRulesOpen} />
    </div>
  );
}
