import { PageSkeleton } from '@/presentation/components/loading/LoadingLayouts';
import { usePageRefresh } from '@/presentation/components/experience/usePageRefresh';
import { useCallback, useEffect, useState } from 'react';
import { ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InboxBreadcrumbs } from '@/presentation/layout/InboxBreadcrumbs';
import { PageTitle, PageTopBar } from '@/presentation/layout/PageChrome';
import { HeaderCompletedTodayPill } from '@/presentation/components/stats/CompletedTodayPill';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import type { Project } from '@/domain/project/Project';
import type { Task } from '@/domain/task/Task';
import { AssignedToMeBlock } from '@/presentation/components/tasks/AssignedToMeBlock';

const HIDE_DONE_STORAGE_KEY = 'inbox.hide-done';

function loadHideDone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(HIDE_DONE_STORAGE_KEY) === '1';
}

// «Входящие» — задачи без привязки к конкретному проекту. Под капотом обычный проект
// с флагом isInbox=true; сервер создаёт его лениво при первом GET /api/inbox.
// Отображение — только канбан (drag-drop по статусам); сортировку/группировку блока
// ответственных выбирают в «Сортировке». Режим списка убран.
export function InboxPage(): React.ReactElement {
  const { projectRepository, taskRepository } = useContainer();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hideDone, setHideDone] = useState<boolean>(loadHideDone);
  // Режим выделения ВЕРХНЕГО блока (вкладки «Мои»/«Для всех»), включается кнопкой в шапке
  // страницы рядом с «Фильтрами». Нижняя доска живёт по-прежнему: там режим включается
  // по колонке из её шапки. Состояние здесь, а не в блоке, — кнопка снаружи блока.
  const [selectionActive, setSelectionActive] = useState(false);
  // Снимок задач своего инбокса. Нижней доски на странице больше нет (канбан ровно один —
  // блок ответственных), но снимок всё равно нужен: в team-пространстве «назначено мне» не
  // отдаёт личный inbox (он живёт в хабе), и без этой выборки личные задачи пропали бы.
  // null = ещё грузится, отличается от честного пустого инбокса.
  const [boardTasks, setBoardTasks] = useState<readonly Task[] | null>(null);
  const reloadInboxTasks = useCallback(
    async (projectId: string, propagateError = false): Promise<void> => {
      try {
        setBoardTasks(await taskRepository.list(projectId));
      } catch (error) {
        if (propagateError) throw error;
        // Блок не должен «залипнуть» в пустом рендере из-за сетевой ошибки: сам он
        // грузит задачи отдельно и покажет их, а личное зеркало просто будет пустым.
        setBoardTasks(current => current ?? []);
      }
    },
    [taskRepository],
  );
  usePageRefresh(() => project ? reloadInboxTasks(project.id, true) : Promise.resolve(), Boolean(project));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    projectRepository
      .getInbox()
      .then((p) => {
        if (!cancelled) setProject(p);
      })
      .catch((e: unknown) => {
        const msg = (e as Error).message ?? 'Не удалось загрузить «Входящие»';
        if (!cancelled) setError(msg);
        toast.error(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectRepository]);

  useEffect(() => {
    if (!project) return;
    void reloadInboxTasks(project.id);
  }, [project, reloadInboxTasks]);

  const handleHideDoneChange = (next: boolean): void => {
    setHideDone(next);
    try {
      window.localStorage.setItem(HIDE_DONE_STORAGE_KEY, next ? '1' : '0');
    } catch {
      // ignore — preference не переживёт reload, но это не критично.
    }
  };

  if (loading) return <PageSkeleton layout="inbox" />;

  if (error || !project) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-md space-y-4 text-center">
          <PageTitle className="justify-center">Не получилось</PageTitle>
          <p className="text-sm text-muted-foreground">{error ?? 'Inbox недоступен'}</p>
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
      {/* Шапка страницы (дизайн C4): крошки «<Пространство> ▾ › Входящие» и счётчик
          «сделано сегодня», линия снизу. На мобиле — своя шапка приложения. */}
      <PageTopBar className="hidden sm:flex" end={<HeaderCompletedTodayPill />}>
        <InboxBreadcrumbs />
      </PageTopBar>

      {/* Тело страницы: плотные поля C4 (16/24/36px). Единственный канбан — блок
          ответственных: заголовок, вкладки, люди и поиск он ставит в одну строку сам. */}
      <div className="flex flex-1 flex-col px-4 pbe-6 pbs-3 sm:px-6 sm:pbs-4 lg:px-9">
        <AssignedToMeBlock
          boardTasks={boardTasks}
          inboxProjectId={project.id}
          onChanged={() => void reloadInboxTasks(project.id)}
          heading={<PageTitle className="me-1">Входящие</PageTitle>}
          actions={
            // Выделение задач блока: режим включается сразу во всех его колонках, в шапке
            // каждой появляются «Все»/«Очистить», снизу — панель действий.
            <Button
              type="button"
              variant={selectionActive ? 'secondary' : 'ghost'}
              size="sm"
              className="gap-1.5 text-muted-foreground hover:text-foreground"
              aria-pressed={selectionActive}
              onClick={() => setSelectionActive((v) => !v)}
            >
              <ListChecks className="size-4" />
              <span className="max-sm:sr-only">
                {selectionActive ? 'Отменить выделение' : 'Выделить'}
              </span>
            </Button>
          }
          hideDone={hideDone}
          onHideDoneChange={handleHideDoneChange}
          selectionActive={selectionActive}
          onSelectionActiveChange={setSelectionActive}
        />
      </div>
    </div>
  );
}

