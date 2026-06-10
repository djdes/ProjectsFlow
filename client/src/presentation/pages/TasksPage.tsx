import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Activity, BookOpen, Bot, ChevronRight, Settings, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useProject } from '@/presentation/hooks/useProject';
import { useContainer } from '@/infrastructure/di/container';
import { KanbanBoard } from '@/presentation/components/tasks/KanbanBoard';
import { AutomationDialog } from '@/presentation/components/project/AutomationDialog';
import { EditableProjectTitle } from '@/presentation/components/project/EditableProjectTitle';

export function TasksPage(): React.ReactElement {
  const { projectId } = useParams<{ projectId: string }>();
  const { data, loading, notFound } = useProject(projectId ?? '');
  const { projectFinanceRepository, monitoringRepository } = useContainer();
  // Гейт видимости кнопки «Финансы»: дёргаем summary только чтобы проверить доступ.
  // Сумму больше не показываем (раньше был чип в шапке), сам блок Доход/Расход/Прибыль
  // живёт на странице /finance.
  const [financeVisible, setFinanceVisible] = useState(false);
  // Гейт кнопки «Мониторинг»: видна участникам — пробуем list, при 403 не показываем.
  const [monitoringVisible, setMonitoringVisible] = useState(false);
  // Число активных алертов — для бейджа на кнопке.
  const [monitoringAlerts, setMonitoringAlerts] = useState(0);
  const [automationOpen, setAutomationOpen] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    projectFinanceRepository
      .getSummary(projectId)
      .then(() => { if (!cancelled) setFinanceVisible(true); })
      .catch(() => { /* нет доступа — кнопку не показываем */ });
    monitoringRepository
      .listServers(projectId)
      .then(() => { if (!cancelled) setMonitoringVisible(true); })
      .catch(() => { /* нет доступа — кнопку не показываем */ });
    monitoringRepository
      .listAlerts(projectId, true)
      .then((a) => { if (!cancelled) setMonitoringAlerts(a.length); })
      .catch(() => { /* нет доступа — без бейджа */ });
    return () => { cancelled = true; };
  }, [projectId, projectFinanceRepository, monitoringRepository]);

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <div className="h-3 w-48 animate-pulse rounded bg-muted" />
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="text-2xl font-semibold">Проект не&nbsp;найден</h1>
          <Button asChild variant="outline">
            <Link to="/">На&nbsp;главную</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4 sm:gap-4 sm:p-6">
      <nav className="flex items-center gap-1 text-sm text-muted-foreground" aria-label="Хлебные крошки">
        <Link to="/" className="hover:text-foreground">
          Проекты
        </Link>
        <ChevronRight className="size-4" />
        <span className="text-foreground">{data.name}</span>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Notion-style: страница называется именем проекта (клик — переименовать).
            Генерик-«Задачи» убран — контекст и так в хлебных крошках. */}
        <EditableProjectTitle projectId={data.id} name={data.name} />
        {/* Действия — тихие иконки с тултипами (Notion top-right style). Тоггл
            мультизадачного воркера переехал в диалог «Автоматизация». */}
        <TooltipProvider delayDuration={300}>
          <div className="flex items-center gap-0.5">
            {financeVisible && (
              <PageActionButton label="Финансы" to={`/projects/${data.id}/finance`}>
                <Wallet className="size-4" />
              </PageActionButton>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-foreground"
                  onClick={() => setAutomationOpen(true)}
                  aria-label="Автоматизация"
                >
                  <Bot className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Автоматизация</TooltipContent>
            </Tooltip>
            <PageActionButton label="База знаний" to={`/projects/${data.id}/kb`}>
              <BookOpen className="size-4" />
            </PageActionButton>
            {monitoringVisible && (
              <PageActionButton label="Мониторинг" to={`/projects/${data.id}/monitoring`}>
                <span className="relative">
                  <Activity className="size-4" />
                  {monitoringAlerts > 0 && (
                    <span
                      className="absolute -right-1.5 -top-1.5 inline-flex min-w-3.5 items-center justify-center rounded-full bg-red-500 px-0.5 text-[9px] font-semibold leading-[14px] text-white"
                      aria-label={`Алертов: ${monitoringAlerts}`}
                    >
                      {monitoringAlerts}
                    </span>
                  )}
                </span>
              </PageActionButton>
            )}
            <PageActionButton label="Настройки" to={`/projects/${data.id}/overview`}>
              <Settings className="size-4" />
            </PageActionButton>
          </div>
        </TooltipProvider>
      </div>

      <KanbanBoard projectId={data.id} projectName={data.name} memberCount={data.memberCount} />

      <AutomationDialog
        open={automationOpen}
        onOpenChange={setAutomationOpen}
        projectId={data.id}
        hasDispatcher={data.dispatcherUserId !== null}
        multiTaskWorker={data.multiTaskWorker}
      />
    </div>
  );
}

// Иконка-действие в шапке страницы: ghost-кнопка + тултип (Notion top-right style).
function PageActionButton({
  label,
  to,
  children,
}: {
  label: string;
  to: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-foreground"
        >
          <Link to={to} aria-label={label}>
            {children}
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
