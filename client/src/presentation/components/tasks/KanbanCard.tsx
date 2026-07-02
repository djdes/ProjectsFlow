import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { motion } from 'motion/react';
import { ArrowRight, Check, ImageIcon, ListChecks, MessageSquare, Trash2 } from 'lucide-react';
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
import { checklistProgress } from '@/lib/checklist';
import { STATUS_LABEL, quickPromoteNext } from './statusLabels';

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

  // Гасим mousedown/touchstart на actions, чтобы нажатие по Edit/Delete/чекбоксу не
  // стартовало drag через активаторы dnd-kit (MouseSensor/TouchSensor) на родителе.
  const stopDrag = (e: React.SyntheticEvent): void => e.stopPropagation();
  const stopDragProps = { onMouseDown: stopDrag, onTouchStart: stopDrag };

  // Прогресс GFM-чеклиста из описания — бейдж «3/7» в мета-строке.
  const checklist = task.description ? checklistProgress(task.description) : null;

  // Есть ли что показывать в нижнем мета-оверлее. Если нет (простая однострочная задача) —
  // не затемняем текст и не рисуем пустую градиент-полосу на hover; кнопки действий
  // (корзина/стрелка) сами маскируют свой угол сплошным фоном.
  const hasMeta = Boolean(
    (task.delegation && currentUserId) ||
      checklist ||
      (task.commentCount ?? 0) > 0 ||
      (task.attachmentCount ?? 0) > 0 ||
      (task.ralphMode && task.ralphMode !== 'normal') ||
      task.deadline ||
      task.status === 'in_progress' ||
      task.status === 'awaiting_clarification',
  );

  // Выполненная задача — для зелёного hover-затемнения и зелёного градиента оверлея
  // (иначе на зелёной карточке нижний градиент from-card давал нейтральную полосу).
  const doneCard = !preview && task.status === 'done';

  // Цель «шага вперёд» для кнопки на hover: Черновики→Вручную, Вручную→Воркер, Воркер→Готово.
  // null (напр. в «Готово») — кнопку не показываем.
  const promoteNext = onQuickPromote ? quickPromoteNext(task.status) : null;

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
          // Открываем диалог только если это был клик, не drag. Активаторы (мышь 8px /
          // тач long-press ~220мс) съедают drag-жест, так что onClick для drag не выстрелит.
          onEdit(task);
        }}
        role="button"
        aria-pressed={selecting ? selected : undefined}
        className={cn(
          // НЕ ставим touch-action:none — иначе палец не сможет скроллить колонку/доску
          // (любое касание карточки превращалось бы в drag). Long-press TouchSensor (~220мс)
          // сам отличает скролл от переноса.
          // Notion-style компактная карточка: минимальный отступ (px-2 py-1.5), без
          // лишнего «воздуха». При hover — только маленькая корзина (оверлей ниже).
          'group relative flex select-none items-start gap-1.5 rounded-lg border border-black/[0.06] bg-card px-2 py-1.5 shadow-sm outline-none dark:border-white/[0.08]',
          // Базовый transition только для тех свойств, которые меняем CSS-ом —
          // transform трогать НЕ нужно, им рулит dnd-kit (см. inline style выше).
          'transition-[box-shadow,border-color,opacity,background-color] duration-150 ease-out',
          'hover:shadow-md',
          // Done-карточка: мягкая зелёная заливка (Notion-style спокойный маркер
          // готовности). На hover — МЯГКОЕ зелёное затемнение (не резкое); текст за
          // кнопками снизу скрывается зелёным градиентом-оверлеем (ниже), как у черновиков.
          doneCard && 'border-success/20 bg-success/[0.06] hover:border-success/30 hover:bg-success/[0.1] dark:hover:bg-success/[0.14]',
          // Priority-accent: цветной левый кант (2px, rose/orange/blue/slate) —
          // спокойный индикатор важности в стиле Todoist (меняется в дравере).
          task.priority && cn('border-l-2', PRIORITY_META[task.priority].border),
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          // Status-акцент: TODO — статичный тонкий янтарный ring «задача ждёт воркера».
          // Стоит ДО selection-ring ниже, чтобы при выделении twMerge оставил ring выбора.
          !preview && task.status === 'todo' && 'ring-1 ring-amber-400/40 dark:ring-amber-300/20',
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
        {/* 🔴 LIVE-индикатор: воркер прямо сейчас работает над задачей (есть running-сессия).
            На hover прячем — там всплывают кнопки действий в том же углу. */}
        {liveRunning && !preview && (
          <span
            aria-label="Воркер работает над задачей"
            title="Воркер работает над задачей"
            className="absolute right-1.5 top-1.5 z-10 size-2 animate-pulse rounded-full bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.7)] transition-opacity group-hover:opacity-0 group-focus-within:opacity-0"
          />
        )}

        {/* Действия — в ПРАВОМ ВЕРХНЕМ углу карточки (на hover/тач). Вынесены из нижней
            мета-строки, чтобы кнопки и мета не конкурировали за место (дедлайн больше не
            сжимается). Сплошной bg-card маскирует текст под кнопками. */}
        {!selecting && !preview && (
          <div
            className="pointer-events-none absolute right-1 top-1 z-20 flex items-center gap-0.5 rounded-md bg-card opacity-0 shadow-sm ring-1 ring-black/[0.06] transition-opacity duration-150 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 max-sm:pointer-events-auto max-sm:opacity-100 dark:ring-white/[0.08]"
            {...stopDragProps}
          >
            {onQuickPromote && promoteNext && (
              <Button
                variant="ghost"
                size="icon"
                className="group/promote size-6 shrink-0 cursor-pointer rounded text-muted-foreground hover:bg-hover hover:text-foreground sm:size-6"
                onClick={(e) => {
                  e.stopPropagation();
                  onQuickPromote(task);
                }}
                aria-label={`Передать в «${STATUS_LABEL[promoteNext]}»`}
                title={`Передать в «${STATUS_LABEL[promoteNext]}»`}
              >
                <ArrowRight className="size-3 transition-transform duration-150 group-hover/promote:translate-x-0.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 cursor-pointer rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive sm:size-6"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(task);
              }}
              aria-label="Удалить"
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
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
            <div className="pt-0.5" {...stopDragProps}>
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
          {/* Текст карточки. На hover ЗАТЕМНЯЕТСЯ — чтобы наложенные снизу мета/корзина
              читались (внахлёст). Высоты под мету НЕ резервируем (нет «пустого промежутка»). */}
          <div
            className={cn(
              'transition-opacity duration-150 max-sm:!opacity-100',
              // Затемняем текст только если снизу реально всплывёт мета-оверлей — и мягче,
              // чем раньше (было opacity-40). Без меты (простая карточка) текст не гаснет.
              hasMeta && 'group-hover:opacity-60 group-focus-within:opacity-60',
            )}
          >
            {task.description?.trim() ? (
              <Markdown
                className={cn(
                  MARKDOWN_COMPACT,
                  'line-clamp-4',
                  '[&_h1]:font-normal [&_h2]:font-normal [&_h3]:font-normal [&_h4]:font-normal',
                  '[&_strong]:font-normal [&_b]:font-normal',
                )}
              >
                {task.description}
              </Markdown>
            ) : (
              <p className="text-sm leading-snug text-muted-foreground">—</p>
            )}
          </div>
        </div>
        {/* Оверлей мета+действий: НЕ занимает высоту (карточка = только текст), на hover
            наложен поверх затемнённого текста снизу. Градиент from-card маскирует текст
            под иконками. Прячется в режиме выделения и drag-preview.
            pointer-events-none на контейнере: иначе невидимый (opacity-0) оверлей снизу
            перехватывал mousedown и не давал начать drag в нижней части карточки. Клики
            ловят только кнопки (pointer-events-auto, и только когда оверлей реально виден).
            Рисуем только если есть что показать (hasMeta) — иначе у простой однострочной
            карточки не будет пустой градиент-полосы снизу. */}
        {!selecting && !preview && hasMeta && (
          <div
            className={cn(
              'pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 rounded-b-lg bg-gradient-to-t to-transparent px-2 pb-1 pt-5 text-[11px] text-muted-foreground opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 max-sm:opacity-100',
              // На done — мягкий зелёный градиент-маска (card, подмешанный к success):
              // снизу непрозрачный (текст за кнопками полностью скрыт), плавно к прозрачному
              // выше. На обычных — нейтральный card. Тот же приём, что у черновиков.
              doneCard
                ? 'from-[color-mix(in_srgb,hsl(var(--card)),hsl(var(--success))_20%)] via-[color-mix(in_srgb,hsl(var(--card)),hsl(var(--success))_20%)]'
                : 'from-card via-card/90',
            )}
          >
            <span className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-hidden">
              {task.delegation && currentUserId && (
                <DelegationBadge delegation={task.delegation} currentUserId={currentUserId} />
              )}
              {checklist && (
                <span
                  className={cn(
                    'flex shrink-0 items-center gap-1 whitespace-nowrap tabular-nums',
                    checklist.done === checklist.total && 'text-emerald-600 dark:text-emerald-400',
                  )}
                  title="Чеклист в описании"
                >
                  <ListChecks className="size-3" />
                  {checklist.done}/{checklist.total}
                </span>
              )}
              {(task.commentCount ?? 0) > 0 && (
                <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">
                  <MessageSquare className="size-3" />
                  {task.commentCount}
                </span>
              )}
              {(task.attachmentCount ?? 0) > 0 && (
                <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">
                  <ImageIcon className="size-3" />
                  {task.attachmentCount}
                </span>
              )}
              <RalphModeBadge mode={task.ralphMode} />
              {task.deadline && <DeadlineBadge deadline={task.deadline} status={task.status} />}
              {task.status === 'in_progress' && (
                <span className="flex shrink-0 items-center gap-1 whitespace-nowrap font-medium text-emerald-700 dark:text-emerald-400">
                  <span aria-hidden className="size-2 rounded-full bg-emerald-500" />
                  {STATUS_LABEL.in_progress}
                </span>
              )}
              {task.status === 'awaiting_clarification' && (
                <span className="flex shrink-0 items-center gap-1 whitespace-nowrap font-medium text-amber-600 dark:text-amber-400">
                  <ClaudeIcon className="size-3" />
                  {STATUS_LABEL.awaiting_clarification}
                </span>
              )}
            </span>
          </div>
        )}
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
