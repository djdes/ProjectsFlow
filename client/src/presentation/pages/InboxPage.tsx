import { useEffect, useState } from 'react';
import { Columns3, Eye, EyeOff, Inbox as InboxIcon, List as ListIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
      <div className="space-y-4 p-6">
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
        'flex h-full flex-col gap-4 p-4 sm:gap-6 sm:p-6',
        // Список — узкая центрированная читаемая колонка (как Todoist). Канбан-доске нужна
        // вся ширина, поэтому ограничение применяем только в list-режиме.
        view === 'list' && 'mx-auto w-full max-w-3xl',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <InboxIcon className="size-7 text-primary" />
          <h1 className="text-3xl font-semibold tracking-tight">Входящие</h1>
        </div>
        <div className="flex items-center gap-2">
          <HideDoneToggle value={hideDone} onChange={handleHideDoneChange} />
          <ViewToggle value={view} onChange={handleViewChange} />
        </div>
      </div>

      <AssignedToMeBlock onChanged={() => setRefetchKey((k) => k + 1)} />

      {view === 'kanban' ? (
        <KanbanBoard key={refetchKey} projectId={project.id} showCommits={false} hideDone={hideDone} />
      ) : (
        <TaskListView key={refetchKey} projectId={project.id} showCommits={false} hideDone={hideDone} />
      )}
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
              'inline-flex size-8 items-center justify-center rounded-md border bg-card transition-colors',
              value
                ? 'border-foreground/30 text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {value ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
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
    <div
      className="inline-flex items-center gap-0.5 rounded-md border bg-card p-0.5 text-xs"
      role="group"
      aria-label="Вид"
    >
      <ToggleButton
        active={value === 'kanban'}
        onClick={() => onChange('kanban')}
        icon={<Columns3 className="size-3.5" />}
        label="Канбан"
      />
      <ToggleButton
        active={value === 'list'}
        onClick={() => onChange('list')}
        icon={<ListIcon className="size-3.5" />}
        label="Список"
      />
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded px-2.5 py-1 transition-colors',
        active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
      aria-pressed={active}
    >
      {icon}
      {label}
    </button>
  );
}
