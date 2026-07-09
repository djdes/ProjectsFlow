import { Calendar } from 'lucide-react';
import { splitTitleBody } from '@/lib/taskTitleBody';
import { coverStyle } from '@/presentation/components/project/coverGallery';
import { ProjectIconView } from '@/presentation/components/project/projectIconView';
import { ColumnPreviewList } from '@/presentation/components/tasks/ColumnPreview';
import { STATUS_LABEL } from '@/presentation/components/tasks/statusLabels';
import type { PublicColumn, PublicTask } from '@/domain/public/PublicBoard';

// Цвет-точка приоритета (Todoist-style): 1=urgent…4=low. null = без точки.
const PRIORITY_COLOR: Record<1 | 2 | 3 | 4, string> = {
  1: '#ef4444',
  2: '#f59e0b',
  3: '#3b82f6',
  4: '#94a3b8',
};

function fmtDeadline(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function PublicCard({
  task,
  onOpen,
}: {
  task: PublicTask;
  onOpen: (taskId: string) => void;
}): React.ReactElement {
  const { title } = splitTitleBody(task.description ?? '');
  return (
    <button
      type="button"
      onClick={() => onOpen(task.id)}
      className="w-full overflow-hidden rounded-lg border border-black/[0.06] bg-white text-left shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-shadow hover:shadow-[0_2px_6px_rgba(15,23,42,0.12)] dark:border-white/[0.08] dark:bg-white/[0.04]"
    >
      {task.cover && (
        <div className="h-16 w-full" style={coverStyle(task.cover, task.coverPosition)} aria-hidden />
      )}
      <div className="flex items-start gap-2 px-3 py-2.5">
        {task.icon && (
          <span className="mt-[1px] grid size-4 shrink-0 place-items-center text-[15px] leading-none">
            <ProjectIconView icon={task.icon} pixelSize={15} />
          </span>
        )}
        <span className="min-w-0 flex-1 break-words text-[13px] leading-snug text-[#37352f] dark:text-blue-50">
          {title || 'Без названия'}
        </span>
        {task.priority && (
          <span
            className="mt-[5px] size-2 shrink-0 rounded-full"
            style={{ backgroundColor: PRIORITY_COLOR[task.priority] }}
            aria-hidden
          />
        )}
      </div>
      {task.deadline && (
        <div className="flex items-center gap-1 px-3 pb-2.5 text-[11px] text-[#37352f]/50 dark:text-blue-100/50">
          <Calendar className="size-3" />
          {fmtDeadline(task.deadline)}
        </div>
      )}
    </button>
  );
}

// Read-only канбан публичной доски: колонки только с задачами (пустые статусы не рисуем,
// чтобы наружу не было визуального шума). Клик по карточке открывает read-only окно задачи.
export function PublicKanban({
  columns,
  onOpenTask,
}: {
  columns: PublicColumn[];
  onOpenTask: (taskId: string) => void;
}): React.ReactElement {
  const visible = columns.filter((c) => c.tasks.length > 0);

  if (visible.length === 0) {
    return (
      <p className="px-1 py-8 text-sm text-muted-foreground">В этом проекте пока нет задач.</p>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {visible.map((col) => (
        <section key={col.status} className="flex w-64 shrink-0 flex-col gap-2">
          <header className="flex items-center gap-2 px-1 text-[13px] font-medium text-[#37352f]/70 dark:text-blue-100/70">
            <span>{STATUS_LABEL[col.status]}</span>
            <span className="text-[#37352f]/40 dark:text-blue-100/40">{col.tasks.length}</span>
          </header>
          <div className="flex flex-col gap-2">
            {/* Порциями по 4 + «Показать ещё» — как на внутренних досках. */}
            <ColumnPreviewList
              items={col.tasks}
              renderItem={(t) => <PublicCard key={t.id} task={t} onOpen={onOpenTask} />}
            />
          </div>
        </section>
      ))}
    </div>
  );
}
