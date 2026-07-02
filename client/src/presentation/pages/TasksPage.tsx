import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Activity, BookOpen, Bot, Settings, Share2, Wallet } from 'lucide-react';
import { ProjectBreadcrumbs } from '@/presentation/layout/ProjectBreadcrumbs';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { ProjectMember } from '@/domain/project/ProjectMembership';
import { useProject } from '@/presentation/hooks/useProject';
import { useContainer } from '@/infrastructure/di/container';
import { KanbanBoard } from '@/presentation/components/tasks/KanbanBoard';
import { AutomationDialog } from '@/presentation/components/project/AutomationDialog';
import { EditableProjectTitle } from '@/presentation/components/project/EditableProjectTitle';
import { ProjectIconPicker } from '@/presentation/components/project/ProjectIconPicker';
import { MemberAvatarStack } from '@/presentation/components/project/MemberAvatarStack';
import { ProjectPublishedBanner } from '@/presentation/components/project/ProjectPublishedBanner';
import { ProjectActivityButton } from '@/presentation/components/project/ProjectActivityButton';

export function TasksPage(): React.ReactElement {
  const { projectId } = useParams<{ projectId: string }>();
  const { data, loading, notFound } = useProject(projectId ?? '');
  const { projectFinanceRepository, monitoringRepository, projectRepository } = useContainer();
  // Гейт видимости кнопки «Финансы»: дёргаем summary только чтобы проверить доступ.
  // Сумму больше не показываем (раньше был чип в шапке), сам блок Доход/Расход/Прибыль
  // живёт на странице /finance.
  const [financeVisible, setFinanceVisible] = useState(false);
  // Гейт кнопки «Мониторинг»: видна участникам — пробуем list, при 403 не показываем.
  const [monitoringVisible, setMonitoringVisible] = useState(false);
  // Число активных алертов — для бейджа на кнопке.
  const [monitoringAlerts, setMonitoringAlerts] = useState(0);
  const [automationOpen, setAutomationOpen] = useState(false);
  // Участники для аватар-стека в шапке (только совместные проекты).
  const [members, setMembers] = useState<ProjectMember[]>([]);

  // Заголовок вкладки браузера = имя проекта (помогает ориентироваться в табах).
  useEffect(() => {
    if (data?.name) document.title = `${data.name} · ProjectsFlow`;
    return () => {
      document.title = 'ProjectsFlow';
    };
  }, [data?.name]);

  useEffect(() => {
    if (!projectId || !data || (data.memberCount ?? 0) <= 1) {
      setMembers([]);
      return;
    }
    let cancelled = false;
    void projectRepository
      .listMembers(projectId)
      .then((list) => {
        if (!cancelled) setMembers(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, data, projectRepository]);

  // Трекинг просмотра проекта: fire-and-forget при открытии (сервер троттлит запись ~30 мин).
  useEffect(() => {
    if (!projectId) return;
    void projectRepository.recordProjectView(projectId).catch(() => undefined);
  }, [projectId, projectRepository]);

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

  // Notion top-alignment: строка крошек (min-h-11, по центру, прижата к верху) встаёт на
  // одну горизонталь со свитчером пространства в сайдбаре; тело — комфортные отступы ниже.
  return (
    <div className="flex h-full flex-col">
      {/* Синяя плашка «проект опубликован» (Notion-style, закрываемая). */}
      <ProjectPublishedBanner projectId={data.id} />
      {/* Хлебные крошки прячем на мобиле: имя проекта дублируется в заголовке ниже,
          навигация — в нижнем таб-баре/drawer. Это возвращает вертикальное место канбану. */}
      <div className="hidden min-h-11 items-center px-2.5 pt-2 sm:flex">
        <ProjectBreadcrumbs
          projectId={data.id}
          projectName={data.name}
          projectIcon={data.icon}
          view="board"
        />
      </div>

      {/* Тело страницы: комфортные отступы ПОД строкой крошек. */}
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-3 pb-3 pt-2 sm:gap-4 sm:px-5 sm:pb-6 sm:pt-1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Notion-style: иконка проекта + имя как заголовок страницы (клик — переименовать).
            Генерик-«Задачи» убран — контекст и так в хлебных крошках. */}
        <div className="flex min-w-0 items-center gap-1.5">
          <ProjectIconPicker projectId={data.id} icon={data.icon} />
          <EditableProjectTitle projectId={data.id} name={data.name} />
        </div>
        {/* Действия — тихие иконки с тултипами (Notion top-right style). Тоггл
            мультизадачного воркера переехал в диалог «Автоматизация». */}
        <TooltipProvider delayDuration={300}>
          <div className="flex items-center gap-0.5">
            {/* Активность/аналитика проекта — слева от участников. */}
            <ProjectActivityButton projectId={data.id} />
            {/* Аватар-стек участников: наведение/клик → панель участников с зумом аватара. */}
            {members.length > 1 && (
              <MemberAvatarStack
                members={members}
                projectId={data.id}
                canInvite={data.role === 'owner' || data.role === 'editor'}
              />
            )}
            {/* «Поделиться» справа от участников (пока заглушка — функционал позже). */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-foreground"
                  aria-label="Поделиться"
                >
                  <Share2 className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Поделиться</TooltipContent>
            </Tooltip>
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

      {/* key={data.id} — при переключении проекта доска полностью пересоздаётся. Иначе
          состояние inline-композера (composingStatus + открытый композер) переживало бы смену
          проекта и «протекало» бы черновиком в storage нового проекта (кнопка «Восстановить»
          вылезала в чужом проекте). Inbox-доска уже монтируется с key (см. InboxPage). */}
      <KanbanBoard
        key={data.id}
        projectId={data.id}
        projectName={data.name}
        memberCount={data.memberCount}
        onOpenAutomation={() => setAutomationOpen(true)}
      />

      <AutomationDialog
        open={automationOpen}
        onOpenChange={setAutomationOpen}
        projectId={data.id}
        hasDispatcher={data.dispatcherUserId !== null}
        multiTaskWorker={data.multiTaskWorker}
      />
      </div>
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
