import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { motion } from 'motion/react';
import { ArrowRight, Check, ImageIcon, MessageSquare, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { SelectModifiers } from './selection/selectionReducer';
import { Markdown, MARKDOWN_COMPACT } from '@/presentation/components/markdown/Markdown';
import type { Task } from '@/domain/task/Task';
import { ClaudeIcon } from './ClaudeIcon';
import { DelegationBadge } from './DelegationBadge';
import { InboxCheckbox } from './InboxCheckbox';
import { RalphModeBadge } from './RalphMode';
import { DeadlineBadge } from './DeadlineBadge';
import { PRIORITY_META } from '@/domain/task/priorityMeta';
import { relativeTime } from '@/lib/relativeTime';
import { STATUS_LABEL } from './statusLabels';

type Props = {
  task: Task;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  // Когда true — рендерится для DragOverlay: без motion-layoutId (иначе конфликт двух
  // элементов с одинаковым id) и без sortable-хуков; плюс «приподнятый» вид.
  preview?: boolean;
  // DEPRECATED: short-id больше не рендерится на карточке (убран по дизайну).
  // Проп оставлен для совместимости с вызывателями (KanbanColumn/TaskListView),
  // которые всё ещё его передают; здесь не используется.
  showShortId?: boolean;
  // Если задан — на карточке появится стрелка → справа, клик «промоутит» задачу
  // в TODO. Используется в backlog-колонке для быстрого triage без drag'а.
  onQuickPromote?: (task: Task) => void;
  // Вызывается после изменения состояния agent-job (enqueue / cancel) — триггерит
  // refetch tasks в родителе чтобы обновить бейдж.
  onTaskChanged?: () => void;
  // Показывать круглый чекбокс «выполнено» слева от описания. Только для inbox
  // и только если задача не в работе у Ralph.
  showCheckbox?: boolean;
  lastDoneTaskId?: string | null;
  lastTodoTaskId?: string | null;
  // Для DelegationBadge: чтобы определить «я создатель / я делегат».
  currentUserId?: string | null;
  // У задачи активна LIVE-сессия воркера — рисуем пульсирующую 🔴 точку в углу карточки.
  liveRunning?: boolean;
  // Режим мультивыделения активен для колонки этой карточки. Тогда drag/drawer
  // отключены, клик тогает выбор, слева — круглый чекбокс.
  selectionMode?: boolean;
  // Карточка сейчас в выборе (для подсветки + галки).
  selected?: boolean;
  // Тогл выбора с модификаторами клавиатуры (shift=диапазон, ctrl/cmd=точечно).
  onSelectToggle?: (taskId: string, mods: SelectModifiers) => void;
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
  onQuickPromote,
  onTaskChanged,
  showCheckbox = false,
  lastDoneTaskId = null,
  lastTodoTaskId = null,
  currentUserId = null,
  liveRunning = false,
  selectionMode = false,
  selected = false,
  onSelectToggle,
}: Props): React.ReactElement {
  // В режиме выделения карточка не таскается и не открывает дравер — клик тогает выбор.
  const selecting = selectionMode && !preview;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'task', task },
    disabled: preview || selecting,
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
        {...(selecting ? {} : attributes)}
        {...(selecting ? {} : listeners)}
        onClick={(e) => {
          if (preview) return;
          // В режиме выделения клик тогает выбор (с учётом shift/ctrl/cmd), а не дравер.
          if (selecting) {
            onSelectToggle?.(task.id, {
              shift: e.shiftKey,
              meta: e.metaKey || e.ctrlKey,
            });
            return;
          }
          // Открываем диалог только если это был именно клик, не drag.
          // PointerSensor activationConstraint distance:5 гарантирует, что drag-старт
          // съест pointermove'ы и onClick не выстрелит для drag'а; обычный клик долетит.
          onEdit(task);
        }}
        role="button"
        aria-pressed={selecting ? selected : undefined}
        className={cn(
          'group relative flex touch-none select-none items-start gap-2 rounded-lg border border-black/[0.06] bg-card p-3 shadow-sm outline-none dark:border-white/[0.08]',
          // Базовый transition только для тех свойств, которые меняем CSS-ом —
          // transform трогать НЕ нужно, им рулит dnd-kit (см. inline style выше).
          'transition-[box-shadow,border-color,opacity] duration-150 ease-out',
          'hover:shadow-md',
          // Priority-accent: цветной левый кант (2px, rose/orange/blue/slate) —
          // спокойный индикатор важности в стиле Todoist (меняется в дравере).
          task.priority && cn('border-l-2', PRIORITY_META[task.priority].border),
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          // Status-акцент: TODO — статичный тонкий янтарный ring «задача ждёт воркера».
          // Стоит ДО selection-ring ниже, чтобы при выделении twMerge оставил ring выбора.
          !preview && task.status === 'todo' && 'ring-1 ring-amber-400/60 dark:ring-amber-300/25',
          // Подсветка выбранной карточки в режиме выделения.
          selecting && selected && 'border-primary ring-2 ring-primary/60',
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
        {/* 🔴 LIVE-индикатор: воркер прямо сейчас работает над задачей (есть running-сессия). */}
        {liveRunning && !preview && (
          <span
            aria-label="Воркер работает над задачей"
            title="Воркер работает над задачей"
            className="absolute right-1.5 top-1.5 z-10 size-2 animate-pulse rounded-full bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.7)]"
          />
        )}
        {selecting ? (
          <span
            aria-hidden
            className={cn(
              'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 transition-colors',
              selected
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-muted-foreground/40',
            )}
          >
            {selected && <Check className="size-3" strokeWidth={3} />}
          </span>
        ) : (
          showCheckbox &&
          !preview && (
            <div className="pt-0.5" onPointerDown={stopDrag}>
              <InboxCheckbox
                task={task}
                lastDoneTaskId={lastDoneTaskId}
                lastTodoTaskId={lastTodoTaskId}
                onChanged={onTaskChanged}
              />
            </div>
          )
        )}
        <div className="min-w-0 flex-1">
          {task.description?.trim() ? (
            <Markdown
              className={cn(
                MARKDOWN_COMPACT,
                'line-clamp-3',
                task.status === 'done' && 'line-through opacity-60',
              )}
            >
              {task.description}
            </Markdown>
          ) : (
            <p className="text-sm leading-snug text-muted-foreground">—</p>
          )}
          {/* Мета-строка: делегирование → счётчики (💬/🖼) → ralph → дедлайн → статус.
              Рендерим только если есть что показать (иначе остаётся лишь футер). */}
          {((task.attachmentCount ?? 0) > 0 ||
            (task.commentCount ?? 0) > 0 ||
            task.ralphMode !== 'normal' ||
            task.status === 'in_progress' ||
            task.status === 'awaiting_clarification' ||
            !!task.delegation ||
            task.deadline !== null) && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              {task.delegation && currentUserId && (
                <DelegationBadge delegation={task.delegation} currentUserId={currentUserId} />
              )}
              {/* Счётчики — монохром без цветных подложек (Notion-style): цвет на карточке
                  остаётся только у семантики (дедлайн/статус/приоритет). */}
              {(task.commentCount ?? 0) > 0 && (
                <span className="flex items-center gap-1">
                  <MessageSquare className="size-3" />
                  {task.commentCount}
                </span>
              )}
              {(task.attachmentCount ?? 0) > 0 && (
                <span className="flex items-center gap-1">
                  <ImageIcon className="size-3" />
                  {task.attachmentCount}
                </span>
              )}
              {/* Бейдж режима Ralph — только для не-дефолта (показывать каждой задаче '🤖 Обычный'
                  было бы шумом). Component сам возвращает null если showDefault=false и mode='normal'. */}
              <RalphModeBadge mode={task.ralphMode} />
              {task.deadline && (
                <DeadlineBadge deadline={task.deadline} status={task.status} />
              )}
              {/* Status-бэйдж справа для статусов, у которых нет своей колонки:
                  in_progress и awaiting_clarification визуально лежат в TODO. */}
              {task.status === 'in_progress' && (
                <span className="ml-auto flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
                  <span aria-hidden className="size-2 rounded-full bg-emerald-500" />
                  {STATUS_LABEL.in_progress}
                </span>
              )}
              {task.status === 'awaiting_clarification' && (
                <span className="ml-auto flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
                  <ClaudeIcon className="size-3" />
                  {STATUS_LABEL.awaiting_clarification}
                </span>
              )}
            </div>
          )}
          {/* Футер: дата слева, кнопки действий справа. Кнопки «тихие» — проявляются
              на hover/focus карточки (на таче — всегда); прячутся целиком в режиме
              выделения (булк-действия сверху) и в drag-preview (чистый оверлей). */}
          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="opacity-60" title={task.createdAt.toLocaleString('ru-RU')}>
              {relativeTime(task.createdAt)}
            </span>
            <div
              className={cn(
                'flex shrink-0 gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 max-sm:opacity-100',
                (selecting || preview) && 'hidden',
              )}
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
                  aria-label="Передать воркеру"
                  title="Передать воркеру"
                >
                  <ArrowRight className="size-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="size-6 cursor-pointer text-muted-foreground hover:text-destructive"
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
