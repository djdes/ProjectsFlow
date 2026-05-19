import { useEffect, useState } from 'react';
import { Columns3, Inbox as InboxIcon, List as ListIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useContainer } from '@/infrastructure/di/container';
import type { Project } from '@/domain/project/Project';
import { KanbanBoard } from '@/presentation/components/tasks/KanbanBoard';
import { TaskListView } from '@/presentation/components/tasks/TaskListView';

type ViewMode = 'kanban' | 'list';
const VIEW_STORAGE_KEY = 'inbox.view-mode';

function loadViewMode(): ViewMode {
  if (typeof window === 'undefined') return 'kanban';
  const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
  return stored === 'list' ? 'list' : 'kanban';
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
    <div className="flex h-full flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <InboxIcon className="size-7 text-primary" />
          <h1 className="text-3xl font-semibold tracking-tight">Входящие</h1>
        </div>
        <ViewToggle value={view} onChange={handleViewChange} />
      </div>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Задачи, которые ещё не&nbsp;привязаны к&nbsp;проекту. Сюда удобно кидать всё,
        что пришло на&nbsp;ум — потом можно разобрать по&nbsp;проектам.
      </p>

      {view === 'kanban' ? (
        <KanbanBoard projectId={project.id} showCommits={false} />
      ) : (
        <TaskListView projectId={project.id} showCommits={false} />
      )}
    </div>
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
