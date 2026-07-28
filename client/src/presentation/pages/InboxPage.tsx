import { useCallback, useEffect, useState } from 'react';
import { ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AnimatedInbox } from '@/presentation/components/nav/AnimatedNavIcons';
import { InboxBreadcrumbs } from '@/presentation/layout/InboxBreadcrumbs';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import type { Project } from '@/domain/project/Project';
import type { Task } from '@/domain/task/Task';
import { AssignedToMeBlock } from '@/presentation/components/tasks/AssignedToMeBlock';

const HIDE_DONE_STORAGE_KEY = 'inbox.hide-done';

// Full-bleed канбана — те же значения, что и на доске проекта (px-6/14/24): ряд колонок
// выносится за паддинг страницы, отступы от краёв совпадают с проектами.
const KANBAN_BLEED_NEG = '-mx-6 sm:-mx-14 lg:-mx-24';
const KANBAN_BLEED_PAD = 'pl-6 sm:pl-14 lg:pl-24';

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
  // Слот в шапке для фильтров/сортировки блока ответственных: сам блок рендерит их сюда через
  // portal (состояние остаётся в блоке, а визуально контролы стоят в строке с «Входящие»).
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);
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
    async (projectId: string): Promise<void> => {
      try {
        setBoardTasks(await taskRepository.list(projectId));
      } catch {
        // Блок не должен «залипнуть» в пустом рендере из-за сетевой ошибки: сам он
        // грузит задачи отдельно и покажет их, а личное зеркало просто будет пустым.
        setBoardTasks([]);
      }
    },
    [taskRepository],
  );

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

  if (loading) {
    return (
      <div className="space-y-3 p-3 pt-3.5 sm:p-6 sm:pt-4">
        <div className="hidden h-3 w-40 animate-pulse rounded bg-muted sm:block" />
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="text-2xl font-semibold">Не получилось</h1>
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
      {/* Хлебные крошки (как у страниц проекта): «<Пространство> ▾ · Входящие». Прячем на мобиле. */}
      <div className="hidden h-11 items-center px-2.5 sm:flex">
        <InboxBreadcrumbs />
      </div>

      {/* Тело страницы: отступы по краям — как на доске проекта (px-6/14/24). Только канбан. */}
      <div className="flex flex-1 flex-col gap-1.5 px-6 pb-3 pt-2 sm:gap-4 sm:px-14 sm:pb-6 sm:pt-1 lg:px-24">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="flex items-center gap-3">
            <AnimatedInbox active className="size-5 text-primary" />
            <h1 className="text-xl font-semibold tracking-tight">Входящие</h1>
          </div>
          {/* Сюда блок ответственных порталит единую кнопку «Фильтры» (сортировка +
              скрыть-выполненные + фильтры от/кому/проект на вкладке «Другим») — слева, сразу
              за заголовком, чтобы не «летала» в одиночестве у правого края. */}
          <div ref={setToolbarSlot} className="flex flex-wrap items-center gap-1" />
          {/* Выделение задач ВЕРХНЕГО блока: режим включается сразу во всех его колонках,
              в шапке каждой появляются «Все»/«Очистить», снизу — панель действий. */}
          <Button
            type="button"
            variant={selectionActive ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs max-sm:h-9"
            aria-pressed={selectionActive}
            onClick={() => setSelectionActive((v) => !v)}
          >
            <ListChecks className="size-4" />
            {selectionActive ? 'Отменить выделение' : 'Выделить'}
          </Button>
        </div>

        {/* Единственный канбан страницы — блок ответственных. Свой DndContext он рендерит
            сам (externalDnd не задан): отдельная нижняя доска инбокса убрана, объединять
            больше нечего. */}
        <AssignedToMeBlock
          boardTasks={boardTasks}
          inboxProjectId={project.id}
          onChanged={() => void reloadInboxTasks(project.id)}
          toolbarSlot={toolbarSlot}
          hideDone={hideDone}
          onHideDoneChange={handleHideDoneChange}
          bleedNegClass={KANBAN_BLEED_NEG}
          bleedPadClass={KANBAN_BLEED_PAD}
          selectionActive={selectionActive}
          onSelectionActiveChange={setSelectionActive}
        />
      </div>
    </div>
  );
}

