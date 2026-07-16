import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Image as ImageIcon, Loader2, Star, Text } from 'lucide-react';
import { ProjectBreadcrumbs } from '@/presentation/layout/ProjectBreadcrumbs';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { ProjectMember } from '@/domain/project/ProjectMembership';
import { useProject } from '@/presentation/hooks/useProject';
import { useContainer } from '@/infrastructure/di/container';
import { useUpdateProject } from '@/presentation/hooks/useUpdateProject';
import { ProjectBoardViews } from '@/presentation/components/tasks/views/ProjectBoardViews';
import { AutomationDialog } from '@/presentation/components/project/AutomationDialog';
import { EditableProjectTitle } from '@/presentation/components/project/EditableProjectTitle';
import { ProjectIconPicker } from '@/presentation/components/project/ProjectIconPicker';
import { MemberAvatarStack } from '@/presentation/components/project/MemberAvatarStack';
import { ProjectActionsMenu } from '@/presentation/components/project/ProjectActionsMenu';
import { ProjectSharePopover } from '@/presentation/components/project/ProjectSharePopover';
import { ProjectPublishedBanner } from '@/presentation/components/project/ProjectPublishedBanner';
import { ProjectWorkerGateBanner } from '@/presentation/components/project/ProjectWorkerGateBanner';
import { ProjectActivityButton } from '@/presentation/components/project/ProjectActivityButton';
import { ProjectCover } from '@/presentation/components/project/ProjectCover';
import { ProjectDescription } from '@/presentation/components/project/ProjectDescription';
import { randomCover } from '@/presentation/components/project/coverGallery';
import { useToggleProjectFavorite } from '@/presentation/hooks/useToggleProjectFavorite';
import { actionErrorMessage } from '@/lib/actionFeedback';

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
  // Окно активности открыто? Пока открыто — действия в шапке страницы прячем (они в окне).
  // Окно активности переживает перезагрузку страницы (sessionStorage пер-проект): открыто
  // до reload → открыто после. Восстанавливаем синхронно в инициализаторе useState.
  const activityStoreKey = `pf-activity-open:${projectId ?? ''}`;
  const [activityOpen, setActivityOpenRaw] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(activityStoreKey) === '1';
    } catch {
      return false;
    }
  });
  const setActivityOpen = (open: boolean): void => {
    setActivityOpenRaw(open);
    try {
      sessionStorage.setItem(activityStoreKey, open ? '1' : '0');
    } catch {
      /* sessionStorage недоступен */
    }
  };
  // Открыто ли окно задачи (overlay сверху) — тогда прячем верхние действия страницы
  // (Изменено/Поделиться/⋯), т.к. они дублируются в шапке самого окна. Сигнал — из TaskDrawer.
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);
  useEffect(() => {
    const onDrawer = (e: Event): void => {
      const open = (e as CustomEvent<{ open?: boolean }>).detail?.open ?? false;
      setTaskDrawerOpen(open);
    };
    window.addEventListener('pf:task-drawer-open', onDrawer);
    return () => window.removeEventListener('pf:task-drawer-open', onDrawer);
  }, []);
  // Участники для аватар-стека в шапке (только совместные проекты).
  const [members, setMembers] = useState<ProjectMember[]>([]);
  // #3: описание можно скрыть/показать (Notion-style toggle над заголовком).
  const [descriptionHidden, setDescriptionHidden] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const { submit: submitProject } = useUpdateProject();
  const { toggle: toggleFavorite } = useToggleProjectFavorite();

  // Заголовок вкладки браузера = имя проекта (помогает ориентироваться в табах).
  useEffect(() => {
    if (data?.name) document.title = `${data.name} · ProjectsFlow`;
    return () => {
      document.title = 'ProjectsFlow';
    };
  }, [data?.name]);

  // Сброс «описание скрыто» при переходе на другой проект (страница не перемонтируется).
  useEffect(() => {
    setDescriptionHidden(false);
  }, [projectId]);

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

  const canEdit = data.role === 'owner' || data.role === 'editor';
  const addRandomCover = async (): Promise<void> => {
    if (coverBusy) return;
    setCoverBusy(true);
    try {
      await submitProject(data.id, { coverUrl: randomCover() });
    } catch (error) {
      toast.error(actionErrorMessage(error, 'Не удалось добавить обложку'));
    } finally {
      setCoverBusy(false);
    }
  };

  const handleFavorite = async (): Promise<void> => {
    if (favoriteBusy) return;
    setFavoriteBusy(true);
    try {
      await toggleFavorite(data.id, !data.isFavorite);
    } finally {
      setFavoriteBusy(false);
    }
  };

  // Действия проекта (участники · Поделиться · ⋯) — один набор, рендерится и в шапке страницы,
  // и в правом верхнем углу окна активности (Notion-style).
  const projectActions = (compact = false) => (
    <>
      {!compact && members.length > 1 && (
        <MemberAvatarStack
          members={members}
          canInvite={data.role === 'owner' || data.role === 'editor'}
          ownerId={data.ownerId}
        />
      )}
      <ProjectSharePopover
        project={data}
        members={members}
        canInvite={data.role === 'owner' || data.role === 'editor'}
        isOwner={data.role === 'owner'}
        compact={compact}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          compact ? 'size-10 sm:size-9' : 'size-8',
          data.isFavorite ? 'text-amber-500' : 'text-muted-foreground hover:text-foreground',
        )}
        disabled={favoriteBusy}
        onClick={() => void handleFavorite()}
        aria-label={data.isFavorite ? 'Убрать проект из избранного' : 'Добавить проект в избранное'}
      >
        {favoriteBusy ? (
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
        ) : (
          <Star className={cn('size-4', data.isFavorite && 'fill-current')} />
        )}
      </Button>
      <ProjectActionsMenu
        project={data}
        financeVisible={financeVisible}
        monitoringVisible={monitoringVisible}
        monitoringAlerts={monitoringAlerts}
        onOpenAutomation={() => setAutomationOpen(true)}
        onOpenTaskFromHistory={() => setActivityOpen(false)}
        compact={compact}
      />
    </>
  );

  // Notion top-alignment: строка крошек (min-h-11, по центру, прижата к верху) встаёт на
  // одну горизонталь со свитчером пространства в сайдбаре; тело — комфортные отступы ниже.
  return (
    // min-h-full (не h-full): страница растёт по контенту, вертикально скроллит её родительский
    // <main overflow-y-auto> целиком (Notion single-scroll — доска не скроллится отдельно).
    <div className="flex min-h-full flex-col" data-pf-project-page>
      <div className="pf-sticky-surface sticky top-0 z-40 flex min-h-11 items-center justify-between gap-2 bg-background px-2 sm:hidden">
        <div className="min-w-0 truncate text-sm font-medium">
          {data.icon ? `${data.icon} ` : ''}
          {data.name}
        </div>
        <TooltipProvider delayDuration={550}>
          <div className="flex shrink-0 items-center gap-0.5">
            <ProjectActivityButton
              projectId={data.id}
              actions={projectActions(true)}
              open={activityOpen}
              onOpenChange={setActivityOpen}
              compact
            />
            {projectActions(true)}
          </div>
        </TooltipProvider>
      </div>
      {/* Хлебные крошки прячем на мобиле: имя проекта дублируется в заголовке ниже,
          навигация — в нижнем таб-баре/drawer. Это возвращает вертикальное место канбану.
          z-40: выше sticky-ячеек таблицы (gutter/frozen-title z-20) — иначе при
          вертикальном скролле строки рисуются ПОВЕРХ крошек/плашек. */}
      <div
        id="pf-project-crumbs"
        className="pf-sticky-surface sticky top-0 z-40 hidden h-11 items-center justify-between gap-2 bg-background px-2.5 sm:flex"
      >
        <ProjectBreadcrumbs
          projectId={data.id}
          projectName={data.name}
          projectIcon={data.icon}
          view="board"
        />
        {/* #1: действия проекта — в строке крошек, по правому краю (Notion top-right). */}
        <TooltipProvider delayDuration={550}>
          <div
            className={cn(
              // При активности блок полностью выпадает из layout; при окне задачи сохраняем
              // прежнее плавное скрытие, потому что его шапка живёт отдельным overlay.
              'flex shrink-0 items-center gap-0.5 transition-opacity duration-500',
              activityOpen && 'hidden',
              !activityOpen && taskDrawerOpen && 'pointer-events-none opacity-0',
            )}
          >
            {/* Активность/аналитика проекта. */}
            {/* Кнопка «Изменено …» открывает окно активности; ему же отдаём действия,
                чтобы они были в правом верхнем углу окна (Notion-style). Пока окно открыто —
                и кнопку «Изменено», и действия шапки прячем (они уже внутри окна). */}
            <ProjectActivityButton
              projectId={data.id}
              actions={projectActions()}
              open={activityOpen}
              onOpenChange={setActivityOpen}
            />
            {projectActions()}
          </div>
        </TooltipProvider>
      </div>
      {/* Синяя плашка «проект опубликован» (Notion-style, закрываемая) — ПОД крошками,
          тоже закреплена при скролле (сразу под sticky-строкой крошек, top-11 = её высота).
          shiftForOverlay: контент центрируется в видимой области, когда открыто окно задачи. */}
      <div id="pf-sticky-banners" className="pf-sticky-surface sticky top-11 z-40">
        <ProjectPublishedBanner projectId={data.id} shiftForOverlay />
        {/* Липкий гейт готовности воркера (репо + делегация + KB) — пока в колонке «Воркер» есть задача. */}
        <ProjectWorkerGateBanner
          projectId={data.id}
          appRepoFullName={data.appRepoFullName}
          kbKind={data.kbKind}
          shiftForOverlay
        />
      </div>

      {/* #3: обложка проекта — во всю ширину, над заголовком (если задана). */}
      {data.coverUrl && (
        <ProjectCover
          projectId={data.id}
          coverUrl={data.coverUrl}
          coverPosition={data.coverPosition}
          canEdit={canEdit}
        />
      )}

      {/* Тело страницы: крупный заголовок с большими отступами по краям (Notion-style).
          flex-1 без min-h-0 — тело заполняет экран при коротком контенте и растёт при длинном. */}
      <div className="flex flex-1 flex-col px-6 pb-10 sm:px-14 sm:pb-12 lg:px-24">
      {/* #2: заголовок проекта — крупный, с большим отступом сверху и по бокам (как в Notion).
          При наведении на «шапку» — панель: добавить обложку / скрыть-показать описание (#3). */}
      <div
        className={cn(
          // Отступ сверху одинаковый независимо от обложки (Notion-style): небольшой зазор
          // до кнопок-действий, затем такой же небольшой до названия проекта.
          'group/head shrink-0 pb-4 pt-3 sm:pb-6 sm:pt-4',
        )}
      >
        {canEdit && (
          // На тач-устройствах hover нет — на мобиле панель видна всегда, на sm+ по наведению.
          <div className="mb-2 flex h-8 items-center gap-1 opacity-100 transition-opacity duration-150 sm:opacity-0 sm:focus-within:opacity-100 sm:group-hover/head:opacity-100">
            {!data.icon && (
              <ProjectIconPicker projectId={data.id} icon={data.icon} variant="head" />
            )}
            {!data.coverUrl && (
              <HeadToolButton onClick={() => void addRandomCover()} disabled={coverBusy}>
                {coverBusy ? (
                  <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                ) : (
                  <ImageIcon className="size-4" />
                )}
                {coverBusy ? 'Добавляем…' : 'Добавить обложку'}
              </HeadToolButton>
            )}
            <HeadToolButton onClick={() => setDescriptionHidden((h) => !h)}>
              <Text className="size-4" />
              {descriptionHidden ? 'Показать описание' : 'Скрыть описание'}
            </HeadToolButton>
          </div>
        )}
        {/* Инлайн-иконка (квадрат) — ТОЛЬКО когда иконка задана, иначе название начинается
            строго слева без отступа (пустой триггер больше не занимает место). */}
        <div className="flex min-w-0 items-center gap-2">
          {data.icon && <ProjectIconPicker projectId={data.id} icon={data.icon} big />}
          <EditableProjectTitle projectId={data.id} name={data.name} />
        </div>
        {!descriptionHidden && (
          // #1: небольшой левый отступ (pl-3 ≈ 12px) — описание чуть отодвинуто от края (как в
          // Notion), не прижато вплотную под иконку.
          // #2: max-w — правый край описания заканчивается «чуть дальше центра» (как в Notion),
          // а не тянется во всю ширину. Канбан ниже при этом остаётся полноширинным.
          <div className="mt-2.5 max-w-3xl pl-3 sm:mt-3">
            <ProjectDescription projectId={data.id} description={data.description} canEdit={canEdit} />
          </div>
        )}
      </div>

      {/* key={data.id} — при переключении проекта доска полностью пересоздаётся. Иначе
          состояние inline-композера (composingStatus + открытый композер) переживало бы смену
          проекта и «протекало» бы черновиком в storage нового проекта (кнопка «Восстановить»
          вылезала в чужом проекте). Inbox-доска уже монтируется с key (см. InboxPage). */}
      {/* Вью доски (Notion-style): вкладки Доска/Таблица/Список/Календарь + польз. вью.
          Канбан внутри — тот же KanbanBoard с теми же пропсами (key переживает контейнер). */}
      <ProjectBoardViews
        key={data.id}
        projectId={data.id}
        projectName={data.name}
        memberCount={data.memberCount}
        canEdit={canEdit}
        onOpenAutomation={() => setAutomationOpen(true)}
        // Full-bleed: доска и её нижний горизонтальный скролл во всю ширину окна (по краям
        // обложки/плашки). Первая колонка отступает как тело страницы (px-6/14/24), последняя
        // доходит до правого края; при скролле колонки уезжают влево до самого края.
        bleedNegClass="-mx-6 sm:-mx-14 lg:-mx-24"
        bleedPadClass="pl-6 sm:pl-14 lg:pl-24"
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

// Мелкая ghost-кнопка панели над заголовком (добавить обложку / скрыть описание).
function HeadToolButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>): React.ReactElement {
  return (
    <button
      type="button"
      className="inline-flex min-h-10 items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-wait disabled:opacity-60 sm:min-h-9"
      {...props}
    >
      {children}
    </button>
  );
}

