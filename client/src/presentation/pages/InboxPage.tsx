import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Columns3, Eye, EyeOff, List as ListIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { fadeInUp } from '@/presentation/components/motion/presets';
import { AnimatedInbox } from '@/presentation/components/nav/AnimatedNavIcons';
import { InboxBreadcrumbs } from '@/presentation/layout/InboxBreadcrumbs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useContainer } from '@/infrastructure/di/container';
import type { Project } from '@/domain/project/Project';
import { KanbanBoard } from '@/presentation/components/tasks/KanbanBoard';
import { TaskListView } from '@/presentation/components/tasks/TaskListView';
import { AssignedToMeBlock } from '@/presentation/components/tasks/AssignedToMeBlock';

type ViewMode = 'kanban' | 'list';
const VIEW_STORAGE_KEY = 'inbox.view-mode';
const HIDE_DONE_STORAGE_KEY = 'inbox.hide-done';

function loadViewMode(): ViewMode {
  if (typeof window === 'undefined') return 'kanban';
  const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
  return stored === 'list' ? 'list' : 'kanban';
}

function loadHideDone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(HIDE_DONE_STORAGE_KEY) === '1';
}

// «Входящие» — задачи без привязки к конкретному проекту. Под капотом обычный проект
// с флагом isInbox=true; сервер создаёт его лениво при первом GET /api/inbox.
// Имеет два режима отображения: kanban (drag-drop по статусам) и list (плоский список
// с группировкой). Выбор юзера сохраняем в localStorage.
export function InboxPage(): React.ReactElement {
  const { projectRepository } = useContainer();
  const { animations } = useMotion();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>(loadViewMode);
  const [hideDone, setHideDone] = useState<boolean>(loadHideDone);
  // refetchKey — простой механизм форсить пересоздание useTasks-хука в KanbanBoard/
  // TaskListView. Меняется при accept/decline/toggle делегирования в AssignedToMeBlock,
  // чтобы список inbox-задач сразу подтянул свежее состояние (acceptance публикует
  // SSE, но проще пересоздать board без задержки).
  const [refetchKey, setRefetchKey] = useState(0);

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

  const handleViewChange = (next: ViewMode): void => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // localStorage может быть недоступен (private mode, quota); это не критично — просто
      // preference не переживёт reload.
    }
  };

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
    <div
      className={cn(
        'flex h-full flex-col',
        // Список — узкая центрированная читаемая колонка (как Todoist). Канбан-доске нужна
        // вся ширина, поэтому ограничение применяем только в list-режиме.
        view === 'list' && 'mx-auto w-full max-w-3xl',
      )}
    >
      {/* Хлебные крошки (как у страниц проекта): «<Пространство> ▾ · Входящие» — сегмент
          пространства раскрывается при наведении для быстрого переключения. Прячем на мобиле.
          Строка крошек = min-h-11 (44px), вертикально центрирована, прижата к верху — ровно
          на одной горизонтали со свитчером пространства в сайдбаре (Notion top-alignment). */}
      <div className="hidden min-h-11 items-center px-2.5 pt-2 sm:flex">
        <InboxBreadcrumbs />
      </div>

      {/* Тело страницы: комфортные отступы ПОД строкой крошек. На мобиле крошек нет —
          даём небольшой верхний отступ, чтобы заголовок не липнул к краю. */}
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-3 pb-3 pt-2 sm:gap-4 sm:px-5 sm:pb-6 sm:pt-1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <AnimatedInbox active className="size-5 text-primary" />
          <h1 className="text-xl font-semibold tracking-tight">Входящие</h1>
        </div>
        <div className="flex items-center gap-2">
          <HideDoneToggle value={hideDone} onChange={handleHideDoneChange} />
          <ViewToggle value={view} onChange={handleViewChange} />
        </div>
      </div>

      <AssignedToMeBlock onChanged={() => setRefetchKey((k) => k + 1)} />

      {/* Мягкое появление списка/доски при входе на страницу — fadeInUp, гейтится
          useMotion(). При выключенных анимациях initial={false} → мгновенно, без
          сдвига лэйаута. Ключ по view, чтобы переключение канбан↔список тоже мягко вплывало. */}
      <motion.div
        key={view}
        className="flex min-h-0 flex-1 flex-col"
        variants={fadeInUp}
        initial={animations ? 'hidden' : false}
        animate="visible"
      >
        {view === 'kanban' ? (
          <KanbanBoard key={refetchKey} projectId={project.id} showCommits={false} hideDone={hideDone} />
        ) : (
          <TaskListView key={refetchKey} projectId={project.id} showCommits={false} hideDone={hideDone} />
        )}
      </motion.div>
      </div>
    </div>
  );
}

function HideDoneToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}): React.ReactElement {
  const label = value ? 'Показать выполненные' : 'Скрыть выполненные';
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => onChange(!value)}
            aria-pressed={value}
            aria-label={label}
            className={cn(
              'group inline-flex size-9 items-center justify-center rounded-lg border bg-card transition active:scale-95 max-sm:size-11',
              value
                ? 'border-foreground/30 text-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
          >
            {value ? (
              <EyeOff className="size-4 transition-transform group-active:scale-90" />
            ) : (
              <Eye className="size-4 transition-transform group-active:scale-90" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function ViewToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (next: ViewMode) => void;
}): React.ReactElement {
  return (
    <SegmentedControl
      value={value}
      onChange={onChange}
      size="md"
      options={[
        { value: 'kanban', label: 'Канбан', icon: <Columns3 className="size-3.5" /> },
        { value: 'list', label: 'Список', icon: <ListIcon className="size-3.5" /> },
      ]}
    />
  );
}
