import { InboxLoadingLayout } from '@/presentation/components/loading/LoadingLayouts';
import { useReadRefreshed } from '@/presentation/hooks/useReadRefreshed';
import { INBOX_SHOW_DONE_KEY, inboxHidesDone, inboxShowDoneValue } from '@/lib/inboxDonePreference';
import { usePageRefresh } from '@/presentation/components/experience/usePageRefresh';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EyeOff, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InboxBreadcrumbs } from '@/presentation/layout/InboxBreadcrumbs';
import { PageTitle, PageTopBar } from '@/presentation/layout/PageChrome';
import { HeaderCompletedTodayPill } from '@/presentation/components/stats/CompletedTodayPill';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import type { Project } from '@/domain/project/Project';
import type { Task } from '@/domain/task/Task';
import { AssignedToMeBlock } from '@/presentation/components/tasks/AssignedToMeBlock';
import { useCurrentWorkspace } from '@/presentation/hooks/useCurrentWorkspace';
import { WorkspaceIcon } from '@/presentation/layout/WorkspaceIcon';

function loadHideDone(): boolean {
  if (typeof window === 'undefined') return true;
  return inboxHidesDone(window.localStorage);
}

// The home button opens the selected workspace's working board.
// The globe opens AllWorkspaceTasksPage without changing the selected workspace.
// Личные задачи живут в обычном проекте с флагом isInbox=true; сервер создаёт его лениво
// при первом GET /api/inbox.
export function InboxPage({
  embedded = false,
  onHideWorkspace,
}: {
  embedded?: boolean;
  onHideWorkspace?: () => void;
}): React.ReactElement {
  const { projectRepository, taskRepository, taskAssigneeRepository } = useContainer();
  const { workspace } = useCurrentWorkspace();
  // Known from an earlier visit, or the copy saved on this device: shown on the first frame and
  // refreshed in the background — a skeleton only for what is not known yet.
  const [known] = useState(() => {
    const inbox = projectRepository.peekInbox();
    return { project: inbox, tasks: inbox ? taskRepository.peekList(inbox.id) : null };
  });
  const [project, setProject] = useState<Project | null>(known.project);
  const [error, setError] = useState<string | null>(null);
  const [hideDone, setHideDone] = useState<boolean>(loadHideDone);
  // Режим выделения ВЕРХНЕГО блока (вкладки «Мои»/«Для всех»), включается кнопкой в шапке
  // страницы рядом с «Фильтрами». Нижняя доска живёт по-прежнему: там режим включается
  // по колонке из её шапки. Состояние здесь, а не в блоке, — кнопка снаружи блока.
  const [selectionActive, setSelectionActive] = useState(false);
  // Снимок задач своего инбокса. Нижней доски на странице больше нет (канбан ровно один —
  // блок ответственных); зеркало ускоряет обновление личных задач после локальных действий.
  // null = ещё грузится, отличается от честного пустого инбокса.
  const [boardTasks, setBoardTasks] = useState<readonly Task[] | null>(known.tasks);
  // latest — after own changes and on pull to refresh: wait for the current list. Otherwise the
  // known list comes at once and a newer one is announced (useReadRefreshed below).
  const reloadInboxTasks = useCallback(
    async (projectId: string, latest: boolean, propagateError = false): Promise<void> => {
      try {
        setBoardTasks(await taskRepository.listForScreen(projectId, { latest }));
      } catch (error) {
        if (propagateError) throw error;
        // Блок не должен «залипнуть» в пустом рендере из-за сетевой ошибки: сам он
        // грузит задачи отдельно и покажет их, а личное зеркало просто будет пустым.
        setBoardTasks(current => current ?? []);
      }
    },
    [taskRepository],
  );
  const projectId = project?.id ?? null;
  usePageRefresh(() => projectId ? reloadInboxTasks(projectId, true, true) : Promise.resolve(), Boolean(projectId));

  const shownProject = useRef(project);
  useEffect(() => {
    shownProject.current = project;
  }, [project]);
  const loadInbox = useCallback(async (): Promise<void> => {
    try {
      setProject(await projectRepository.getInbox());
      setError(null);
    } catch {
      // What is known stays on screen; the error replaces the page only when nothing is.
      if (shownProject.current) return;
      const msg = 'Не удалось загрузить «Входящие» этого пространства. Повторите попытку.';
      setError(msg);
      toast.error(msg);
    }
  }, [projectRepository]);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  // First visit on this device (the inbox project is not known yet): the lists start loading
  // alongside it, not after it — the board mounts and takes them (one round trip, not two).
  useEffect(() => {
    if (!known.project) void taskAssigneeRepository.loadInboxOverview().catch(() => undefined);
  }, [known.project, taskAssigneeRepository]);

  useEffect(() => {
    if (projectId) void reloadInboxTasks(projectId, false);
  }, [projectId, reloadInboxTasks]);

  // A newer answer than the one shown arrived in the background: re-read, now from memory.
  // Unchanged data comes back as the same objects, so only what changed re-renders.
  useReadRefreshed(() => {
    void loadInbox();
    if (projectId) void reloadInboxTasks(projectId, false);
  });

  const handleHideDoneChange = (next: boolean): void => {
    setHideDone(next);
    try {
      window.localStorage.setItem(INBOX_SHOW_DONE_KEY, inboxShowDoneValue(next));
    } catch {
      // ignore — preference не переживёт reload, но это не критично.
    }
  };

  // Своя страница — заголовок страницы прямо в строке управления: название пространства уже
  // стоит в крошках (на телефоне — в шапке приложения), отдельная строка с ним только
  // повторяла его и отодвигала задачи вниз. На «Всех задачах» блоков несколько, там
  // заголовок блока — его пространство.
  const heading = embedded
    ? <CurrentWorkspaceHeading name={workspace?.name ?? 'Пространство'} icon={workspace?.icon ?? null} />
    : <PageTitle className="me-1">Задачи пространства</PageTitle>;

  if (error && !project) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-md space-y-4 text-center">
          <PageTitle className="justify-center">Не получилось</PageTitle>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Перезагрузить
          </Button>
        </div>
      </div>
    );
  }

  return (
    // min-h-full (не h-full): страница растёт по контенту, вертикально скроллит её
    // родительский <main overflow-y-auto> целиком (Notion single-scroll, как страницы
    // проекта). Тогда закреплённый снизу горизонтальный скролл-бар доски (SyncedStickyScrollbar)
    // прилипает к низу вьюпорта так же, как на проектах, — а не к внутреннему скролл-порту.
    <div className="flex min-h-full flex-col">
      {/* Шапка страницы: выбранное пространство и счётчик
          «сделано сегодня», линия снизу. На мобиле — своя шапка приложения. */}
      {!embedded && <PageTopBar className="hidden sm:flex" end={<HeaderCompletedTodayPill />}>
        <InboxBreadcrumbs />
      </PageTopBar>}

      {/* Тело страницы: плотные поля C4 (16/24/36px). Единственный канбан — блок
          ответственных текущего пространства: заголовок, «Мои / Все», людей и поиск он
          ставит в одну строку сам. */}
      {/* Верхний отступ меньше, чем у остальных страниц, ровно на то, на сколько строка
          управления выше самого заголовка (44px с иконками на телефоне, 32px с поиском на
          десктопе): заголовок встаёт на те же 16/20px от шапки, что и везде. */}
      {/* Телефон: строки заголовка нет (см. compactHeading) — лента «кто» стоит в 12px от шапки. */}
      <div className={embedded ? 'flex flex-1 flex-col gap-3' : 'flex flex-1 flex-col gap-3 px-4 pbe-6 pbs-3 sm:px-6 sm:pbs-[1.125rem] lg:px-9'}>
        {/* The inbox project is not known yet (first visit on this device): the page and its
            title are already in place, the board below waits — as AssignedToMeBlock does. */}
        {!project ? (
          <section className="flex flex-col gap-3">
            <InboxLoadingLayout heading={heading} compactHeading={!embedded} />
          </section>
        ) : <AssignedToMeBlock
          regionId={embedded ? `workspace-board-${workspace?.id}` : undefined}
          initialTab={embedded ? 'toMe' : undefined}
          tabStorageKey={embedded ? `pf.inbox.global.${workspace?.id}.tab` : undefined}
          boardTasks={boardTasks}
          inboxProjectId={project.id}
          onChanged={() => void reloadInboxTasks(project.id, true)}
          heading={heading}
          actions={
            <>
              {/* Выделение задач блока: режим включается сразу во всех его колонках, в шапке
                  каждой появляются «Все»/«Очистить», снизу — панель действий. */}
              <Button
                type="button"
                variant={selectionActive ? 'secondary' : 'ghost'}
                size="sm"
                className="h-11 min-w-11 gap-1.5 px-2 text-muted-foreground hover:text-foreground md:h-8"
                aria-pressed={selectionActive}
                onClick={() => setSelectionActive((v) => !v)}
              >
                <ListChecks className="size-4" />
                <span className="max-sm:sr-only">
                  {selectionActive ? 'Отменить выделение' : 'Выделить'}
                </span>
              </Button>
              {embedded && onHideWorkspace && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-11 min-w-11 gap-1.5 px-2 text-muted-foreground hover:text-foreground md:h-8"
                  title="Скрыть пространство со страницы «Все задачи»"
                  aria-label={`Скрыть пространство «${workspace?.name ?? 'Пространство'}»`}
                  onClick={onHideWorkspace}
                >
                  <EyeOff className="size-4" />
                  <span className="max-sm:sr-only">Скрыть</span>
                </Button>
              )}
            </>
          }
          hideDone={hideDone}
          onHideDoneChange={handleHideDoneChange}
          selectionActive={selectionActive}
          onSelectionActiveChange={setSelectionActive}
          compactHeading={!embedded}
        />}
      </div>
    </div>
  );
}

// Заголовок блока на «Всех задачах» — его пространство: страница читается как список
// пространств.
function CurrentWorkspaceHeading({ name, icon }: { name: string; icon: string | null }): React.ReactElement {
  return (
    <h2 className="me-1 flex min-w-0 items-center gap-2 text-base font-semibold">
      <WorkspaceIcon name={name} icon={icon} className="size-6" />
      <span className="min-w-0 truncate">{name}</span>
    </h2>
  );
}

