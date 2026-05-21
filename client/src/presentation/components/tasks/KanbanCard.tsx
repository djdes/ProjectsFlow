import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { motion } from 'motion/react';
import { ArrowRight, GitCommit, ImageIcon, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Task } from '@/domain/task/Task';
import { taskShortId } from '@/domain/task/Task';
import { AgentJobBadge } from './AgentJobBadge';
import { DelegateToAgentButton } from './DelegateToAgentButton';

type Props = {
  task: Task;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  // Когда true — рендерится для DragOverlay: без motion-layoutId (иначе конфликт двух
  // элементов с одинаковым id) и без sortable-хуков; плюс «приподнятый» вид.
  preview?: boolean;
  // Показывать short-id [xxxxxxxx] на карточке. Для inbox-проекта скрываем — там
  // нет git-репо, привязка коммитов через `[short-id]` бессмысленна.
  showShortId?: boolean;
  // Если задан — на карточке появится стрелка → справа, клик «промоутит» задачу
  // в TODO. Используется в backlog-колонке для быстрого triage без drag'а.
  onQuickPromote?: (task: Task) => void;
  // Вызывается после изменения состояния agent-job (enqueue / cancel) — триггерит
  // refetch tasks в родителе чтобы обновить бейдж.
  onTaskChanged?: () => void;
};

// Кастомный transition для reflow соседей при drag. Out-quart — плавнее дефолтного
// out-cubic от dnd-kit'а: разгон быстрый, замедление длинное → визуально «мягче».
const DND_TRANSITION = {
  duration: 220,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
};

export function KanbanCard({
  task,
  onEdit,
  onDelete,
  preview = false,
  showShortId = true,
  onQuickPromote,
  onTaskChanged,
}: Props): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'task', task },
    disabled: preview,
    transition: DND_TRANSITION,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // motion.div снаружи — обрабатывает layout-переходы между колонками (auto-transition
  // после Sync commits, ручной link и пр.). dnd-kit'овский transform — отдельный inline-style
  // на inner div, не конфликтует с motion'овским layout-уровнем.
  // Для preview-варианта (DragOverlay) motion-обёртка отключена — иначе два элемента с одним
  // layoutId.
  const Wrapper = preview ? PassthroughWrapper : MotionWrapper;

  // Останавливаем pointerdown на actions, чтобы клик по Edit/Delete не стартовал drag
  // через listeners на родителе. (activationConstraint distance:5 ловит мелкие движения,
  // но если юзер чуть-чуть двинул мышь — драг бы запустился; со stopPropagation это
  // окончательно исключено.)
  const stopDrag = (e: React.PointerEvent): void => e.stopPropagation();

  return (
    <Wrapper layoutId={task.id}>
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        onClick={() => {
          // Открываем диалог только если это был именно клик, не drag.
          // PointerSensor activationConstraint distance:5 гарантирует, что drag-старт
          // съест pointermove'ы и onClick не выстрелит для drag'а; обычный клик долетит.
          if (!preview) onEdit(task);
        }}
        role="button"
        className={cn(
          'group relative flex touch-none select-none items-start gap-2 rounded-md border bg-card p-3 shadow-sm outline-none',
          // Базовый transition только для тех свойств, которые меняем CSS-ом —
          // transform трогать НЕ нужно, им рулит dnd-kit (см. inline style выше).
          'transition-[box-shadow,border-color,opacity] duration-150 ease-out',
          'hover:shadow-md',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          // Status-аcent: TODO — пульсирующее янтарное неоновое «дыхание». Сообщает
          // «эта задача ждёт, чтобы её взяли в работу». Анимируется box-shadow
          // (composited на GPU, без layout-reflow). Остальные статусы — нейтральный
          // border-color (foreground/20 на hover).
          !preview && task.status === 'todo'
            ? 'border-amber-500/60 animate-todo-glow hover:border-amber-500/80'
            : !preview && 'hover:border-foreground/20',
          preview
            ? // Карточка в DragOverlay: «приподнятый» вид — мощная тень, ring, выраженная
              // граница. Tilt/scale делаем НЕ здесь, а на motion-обёртке в KanbanBoard —
              // иначе CSS-transform запекается в snapshot DragOverlay и при drop остаётся
              // «висеть наклонённым», пока внешний transform лерпится к месту.
              'cursor-grabbing border-foreground/30 shadow-2xl ring-2 ring-primary/20'
            : // На hover'е карточка кликабельна (открывает диалог) → cursor-pointer.
              // grabbing включается только когда юзер реально потащил (isDragging ниже).
              'cursor-pointer',
          // Оригинал на месте, пока тащим preview — делаем призрачным и меняем курсор
          // на grabbing (юзер визуально taskает оверлей, но если случайно нависнет на
          // оригинале — курсор не сбивается обратно на pointer).
          isDragging && !preview && 'cursor-grabbing opacity-30',
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="line-clamp-3 whitespace-pre-wrap text-sm leading-snug">
            {task.description ?? '—'}
          </p>
          {(showShortId || (task.commitCount ?? 0) > 0 || (task.attachmentCount ?? 0) > 0) && (
            <div className="mt-2 flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
              {showShortId && (
                <span className="font-mono normal-case tracking-normal opacity-60">
                  [{taskShortId(task.id)}]
                </span>
              )}
              {(task.commitCount ?? 0) > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-blue-500/15 px-1.5 py-0.5 text-blue-600 dark:bg-blue-400/15 dark:text-blue-400">
                  <GitCommit className="size-2.5" />
                  {task.commitCount}
                </span>
              )}
              {(task.attachmentCount ?? 0) > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-400">
                  <ImageIcon className="size-2.5" />
                  {task.attachmentCount}
                </span>
              )}
            </div>
          )}
          {task.agentJob && onTaskChanged && (
            <div className="mt-2" onPointerDown={(e) => e.stopPropagation()}>
              <AgentJobBadge
                job={task.agentJob}
                projectId={task.projectId}
                onChanged={onTaskChanged}
              />
            </div>
          )}
        </div>
        <div
          className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
          onPointerDown={stopDrag}
        >
          {onQuickPromote && !preview && (
            <Button
              variant="ghost"
              size="icon"
              className="size-6 cursor-pointer text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onQuickPromote(task);
              }}
              aria-label="Перенести в TODO"
              title="Перенести в TODO"
            >
              <ArrowRight className="size-3.5" />
            </Button>
          )}
          {!preview &&
            onTaskChanged &&
            task.status === 'todo' &&
            (!task.agentJob ||
              task.agentJob.status === 'succeeded' ||
              task.agentJob.status === 'failed' ||
              task.agentJob.status === 'cancelled') && (
              <DelegateToAgentButton
                projectId={task.projectId}
                taskId={task.id}
                hasDescription={Boolean(task.description?.trim())}
                onEnqueued={onTaskChanged}
              />
            )}
          <Button
            variant="ghost"
            size="icon"
            className="size-6 cursor-pointer text-destructive hover:text-destructive"
            onClick={(e) => {
              // Чтобы клик по корзине не открыл диалог через onClick на родителе.
              e.stopPropagation();
              onDelete(task);
            }}
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
