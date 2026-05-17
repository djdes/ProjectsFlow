import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { motion } from 'motion/react';
import { GitCommit, GripVertical, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Task } from '@/domain/task/Task';
import { taskShortId } from '@/domain/task/Task';

type Props = {
  task: Task;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  // Когда true — рендерится для DragOverlay: без motion-layoutId (иначе конфликт двух
  // элементов с одинаковым id) и без sortable-хуков.
  preview?: boolean;
};

export function KanbanCard({ task, onEdit, onDelete, preview = false }: Props): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'task', task },
    disabled: preview,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Прячем оригинал при перетаскивании, оставляя placeholder.
    opacity: isDragging ? 0.4 : 1,
  };

  // motion.div снаружи — обрабатывает layout-переходы между колонками (auto-transition
  // после Sync commits, ручной link и пр.). dnd-kit'овский transform — отдельный inline-style
  // на inner div, не конфликтует с motion'овским layout-уровнем.
  // Для preview-варианта (DragOverlay) motion-обёртка отключена — иначе два элемента с одним
  // layoutId.
  const Wrapper = preview ? PassthroughWrapper : MotionWrapper;
  return (
    <Wrapper layoutId={task.id}>
    <div
      ref={setNodeRef}
      style={style}
      className="group flex items-start gap-2 rounded-md border bg-card p-3 shadow-sm transition-[box-shadow,border-color,transform] hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-md"
    >
      <button
        type="button"
        className="mt-0.5 cursor-grab text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing"
        aria-label="Перетащить"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug">{task.title}</p>
        {task.description && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{task.description}</p>
        )}
        <div className="mt-2 flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
          <span className="font-mono normal-case tracking-normal opacity-60">
            [{taskShortId(task.id)}]
          </span>
          {(task.commitCount ?? 0) > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-blue-500/15 px-1.5 py-0.5 text-blue-600 dark:bg-blue-400/15 dark:text-blue-400">
              <GitCommit className="size-2.5" />
              {task.commitCount}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={() => onEdit(task)}
          aria-label="Редактировать"
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-destructive hover:text-destructive"
          onClick={() => onDelete(task)}
          aria-label="Удалить"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
    </Wrapper>
  );
}

function MotionWrapper({
  layoutId,
  children,
}: {
  layoutId: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <motion.div
      layout="position"
      layoutId={layoutId}
      initial={false}
      transition={{ type: 'spring', stiffness: 500, damping: 38, mass: 0.6 }}
    >
      {children}
    </motion.div>
  );
}

function PassthroughWrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  return <>{children}</>;
}
