import { Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { splitTitleBody } from '@/lib/taskTitleBody';
import { PRIORITY_META } from '@/domain/task/priorityMeta';
import type { TaskStatus } from '@/domain/task/Task';
import { coverStyle } from '@/presentation/components/project/coverGallery';
import { ProjectIconView } from '@/presentation/components/project/projectIconView';
import { ColumnPreviewList } from '@/presentation/components/tasks/ColumnPreview';
import { STATUS_LABEL } from '@/presentation/components/tasks/statusLabels';
import type { PublicColumn, PublicTask } from '@/domain/public/PublicBoard';

// Тон метки статуса в шапке колонки — цвет = смысл, как на досках приложения: на утверждении
// фиолетовый, вручную янтарный, очередь/в работе синий, готово зелёный, остальное серое.
// Классы выписаны буквально, чтобы Tailwind их видел.
const STATUS_TONE: Partial<Record<TaskStatus, string>> = {
  pending_approval: 'pf-tone-approval',
  manual: 'pf-tone-manual',
  todo: 'pf-tone-queue',
  in_progress: 'pf-tone-queue',
  done: 'pf-tone-done',
};

export function publicStatusTone(status: TaskStatus): string {
  return STATUS_TONE[status] ?? 'pf-tone-gray';
}

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
  showMeta,
}: {
  task: PublicTask;
  onOpen: (taskId: string) => void;
  showMeta: boolean;
}): React.ReactElement {
  const { title } = splitTitleBody(task.description ?? '');
  return (
    // Карточка C4 — как на досках приложения: белая на серой колонке, держится тенью-кольцом,
    // при наведении тень глубже (в тёмной теме — ступень светлее).
    <button
      type="button"
      onClick={() => onOpen(task.id)}
      className="w-full overflow-clip rounded-lg bg-card text-start shadow-card transition-[box-shadow,background-color] hover:shadow-card-hover dark:hover:bg-card-hover"
    >
      {task.cover && (
        <div className="h-16 w-full" style={coverStyle(task.cover, task.coverPosition)} aria-hidden />
      )}
      <div className="flex items-start gap-2 px-2.5 py-[7px]">
        {task.icon && (
          <span className="mbs-px grid size-4 shrink-0 place-items-center text-sm leading-none">
            <ProjectIconView icon={task.icon} pixelSize={15} />
          </span>
        )}
        <span className="min-w-0 flex-1 break-words text-task leading-snug text-card-foreground">
          {title || 'Без названия'}
        </span>
        {showMeta && task.priority && (
          <span
            className={cn('mbs-[5px] size-2 shrink-0 rounded-full', PRIORITY_META[task.priority].dotColor)}
            aria-hidden
          />
        )}
      </div>
      {showMeta && task.deadline && (
        <div className="flex items-center gap-1 px-2.5 pbe-[7px] text-meta text-muted-foreground">
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
  showTaskMeta = true,
}: {
  columns: PublicColumn[];
  onOpenTask: (taskId: string) => void;
  showTaskMeta?: boolean;
}): React.ReactElement {
  const visible = columns.filter((c) => c.tasks.length > 0);

  if (visible.length === 0) {
    return (
      <p className="px-1 py-8 text-sm text-muted-foreground">В этом проекте пока нет задач.</p>
    );
  }

  return (
    <div className="flex items-start gap-3 overflow-x-auto overscroll-x-contain pbe-4">
      {visible.map((col) => (
        // Колонка C4: серая панель, шапка 28px — метка статуса цветом смысла и счётчик.
        <section
          key={col.status}
          aria-label={STATUS_LABEL[col.status]}
          className="flex w-64 shrink-0 flex-col gap-[5px] rounded-xl bg-panel p-1.5"
        >
          <header className="flex h-7 items-center gap-1.5 px-1">
            <span className={cn('pf-tag pf-tag-lg', publicStatusTone(col.status))}>
              <span className="truncate">{STATUS_LABEL[col.status]}</span>
            </span>
            <span className="text-meta tabular-nums text-muted-foreground">{col.tasks.length}</span>
          </header>
          <div className="flex flex-col gap-[5px]">
            {/* Порциями по 4 + «Показать ещё» — как на внутренних досках. */}
            <ColumnPreviewList
              items={col.tasks}
              renderItem={(t) => (
                <PublicCard key={t.id} task={t} onOpen={onOpenTask} showMeta={showTaskMeta} />
              )}
            />
          </div>
        </section>
      ))}
    </div>
  );
}
