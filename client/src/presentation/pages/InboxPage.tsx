import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { fadeInUp } from '@/presentation/components/motion/presets';
import { AnimatedInbox } from '@/presentation/components/nav/AnimatedNavIcons';
import { InboxBreadcrumbs } from '@/presentation/layout/InboxBreadcrumbs';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import type { Project } from '@/domain/project/Project';
import type { Task } from '@/domain/task/Task';
import { KanbanBoard } from '@/presentation/components/tasks/KanbanBoard';
import { AssignedToMeBlock } from '@/presentation/components/tasks/AssignedToMeBlock';
import { InboxUnifiedDnd } from '@/presentation/components/tasks/InboxUnifiedDnd';
import { useBoardStickyTop } from '@/presentation/components/tasks/useBoardStickyTop';
import type { UnifiedDndRegistry } from '@/presentation/components/tasks/unifiedDndTypes';

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
  const { projectRepository } = useContainer();
  const { animations } = useMotion();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hideDone, setHideDone] = useState<boolean>(loadHideDone);
  // Слот в шапке для фильтров/сортировки блока ответственных: сам блок рендерит их сюда через
  // portal (состояние остаётся в блоке, а визуально контролы стоят в строке с «Входящие»).
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);
  // refetchKey — простой механизм форсить пересоздание useTasks-хука в KanbanBoard/
  // TaskListView. Меняется при смене ответственного/toggle в AssignedToMeBlock,
  // чтобы список inbox-задач сразу подтянул свежее состояние (acceptance публикует
  // SSE, но проще пересоздать board без задержки).
  const [refetchKey, setRefetchKey] = useState(0);
  // null отличает «нижняя доска ещё грузится» от честного пустого inbox. После загрузки
  // этот же snapshot питает виртуальные карточки верхней личной колонки.
  const [boardTasks, setBoardTasks] = useState<readonly Task[] | null>(null);
  const handleBoardTasksChange = useCallback((next: readonly Task[]): void => {
    setBoardTasks(next);
  }, []);
  // Реестр единого DnD (#5): доска и блок ответственных регистрируют сюда свои хендлеры,
  // InboxUnifiedDnd диспетчеризует. Ref (не state) — стабильная ссылка переживает ремаунты
  // KanbanBoard по refetchKey и не дёргает лишние рендеры.
  const dndRegistry = useRef<UnifiedDndRegistry>({ board: null, block: null });
  // Шапки колонок доски закрепляются у верхней кромки <main> — своих sticky-строк
  // (крошки/плашки) у «Входящих» нет, поэтому офсет = только верх скролл-контейнера.
  const stickyTop = useBoardStickyTop();

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
    <div className="flex h-full flex-col">
      {/* Хлебные крошки (как у страниц проекта): «<Пространство> ▾ · Входящие». Прячем на мобиле. */}
      <div className="hidden h-11 items-center px-2.5 sm:flex">
        <InboxBreadcrumbs />
      </div>

      {/* Тело страницы: отступы по краям — как на доске проекта (px-6/14/24). Только канбан. */}
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-6 pb-3 pt-2 sm:gap-4 sm:px-14 sm:pb-6 sm:pt-1 lg:px-24">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="flex items-center gap-3">
            <AnimatedInbox active className="size-5 text-primary" />
            <h1 className="text-xl font-semibold tracking-tight">Входящие</h1>
          </div>
          {/* Сюда блок ответственных порталит единую кнопку «Фильтры» (сортировка +
              скрыть-выполненные + фильтры от/кому/проект на вкладке «Другим») — слева, сразу
              за заголовком, чтобы не «летала» в одиночестве у правого края. */}
          <div ref={setToolbarSlot} className="flex flex-wrap items-center gap-1" />
        </div>

        {/* Единый DnD (#5): один DndContext на блок ответственных И доску — карточку доски
            можно тащить в колонки срока и на участников (назначить ответственным). */}
        <InboxUnifiedDnd registry={dndRegistry} projectId={project.id}>
          <AssignedToMeBlock
            boardTasks={boardTasks}
            inboxProjectId={project.id}
            onChanged={() => setRefetchKey((k) => k + 1)}
            toolbarSlot={toolbarSlot}
            hideDone={hideDone}
            onHideDoneChange={handleHideDoneChange}
            bleedNegClass={KANBAN_BLEED_NEG}
            bleedPadClass={KANBAN_BLEED_PAD}
            externalDnd={dndRegistry}
          />

          {/* Мягкое появление доски при входе — fadeInUp, гейтится useMotion(). */}
          <motion.div
            className="flex min-h-0 flex-1 flex-col"
            variants={fadeInUp}
            initial={animations ? 'hidden' : false}
            animate="visible"
          >
            <KanbanBoard
              key={refetchKey}
              projectId={project.id}
              showCommits={false}
              hideDone={hideDone}
              stickyHeaderTop={stickyTop}
              bleedNegClass={KANBAN_BLEED_NEG}
              bleedPadClass={KANBAN_BLEED_PAD}
              externalDnd={dndRegistry}
              onBoardTasksChange={handleBoardTasksChange}
            />
          </motion.div>
        </InboxUnifiedDnd>
      </div>
    </div>
  );
}

