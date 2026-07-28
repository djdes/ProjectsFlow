import { memo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { motion } from 'motion/react';
import { useSidebarResizing } from '@/presentation/layout/sidebarResizingContext';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { ArrowRight, Check, ImageIcon, ListChecks, MessageSquare, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { SelectModifiers } from './selection/selectionReducer';
import { Markdown, MARKDOWN_COMPACT } from '@/presentation/components/markdown/Markdown';
import { TaskTitleText } from './TaskTitleText';
import { splitTitleBody } from '@/lib/taskTitleBody';
import { ProjectIconView } from '@/presentation/components/project/projectIconView';
import type { Task } from '@/domain/task/Task';
import { ClaudeIcon } from './ClaudeIcon';
import { AssigneeBadge } from './AssigneeBadge';
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
  // Показывать действие «выполнено» первым в hover-панели карточки. Только для inbox
  // и только если задача не в работе у Ralph.
  showCheckbox?: boolean;
  lastDoneTaskId?: string | null;
  lastTodoTaskId?: string | null;
  // Оставлен в публичном контракте карточки для совместимости с представлениями.
  currentUserId?: string | null;
  // У задачи активна LIVE-сессия воркера — рисуем пульсирующую 🔴 точку в углу карточки.
  liveRunning?: boolean;
  // E4: карточка открыта в drawer'е (слегка синяя + синий бордер) / только что перемещена
  // drag'ом (выделена синим, держится до клика в стороне).
  open?: boolean;
  recentlyMoved?: boolean;
  // Режим мультивыделения активен для колонки этой карточки. Тогда drag/drawer
  // отключены, клик тогает выбор, слева — круглый чекбокс.
  selectionMode?: boolean;
  // Карточка сейчас в выборе (для подсветки + галки).
  selected?: boolean;
  // Тогл выбора с модификаторами клавиатуры (shift=диапазон, ctrl/cmd=точечно).
  onSelectToggle?: (taskId: string, mods: SelectModifiers) => void;
  // Индикатор дропа (Notion): синяя полоска В ЗАЗОРЕ над/под карточкой — АБСОЛЮТНАЯ,
  // не занимает место в потоке (соседи НЕ раздвигаются). 'before'/'after'/null.
  dropLine?: 'before' | 'after' | null;
  readOnly?: boolean;
};

// Кастомный transition для reflow соседей при drag. Out-quart — плавнее дефолтного
// out-cubic от dnd-kit'а: разгон быстрый, замедление длинное → визуально «мягче».
const DND_TRANSITION = {
  duration: 220,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
};

// Тач-устройство? Считаем ОДИН раз при загрузке модуля (тип указателя не меняется в рантайме).
// На тач-девайсах (телефон/PWA) полностью отключаем framer-motion layout-обёртку карточек:
// пер-карточный layout-пересчёт 200+ элементов — главный источник лагов при скролле доски.
const IS_COARSE_POINTER =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: coarse)').matches;

function KanbanCardImpl({
  task,
  onEdit,
  onDelete,
  preview = false,
  onQuickPromote,
  onTaskChanged,
  showCheckbox = false,
  lastDoneTaskId = null,
  lastTodoTaskId = null,
  liveRunning = false,
  open = false,
  recentlyMoved = false,
  selectionMode = false,
  selected = false,
  onSelectToggle,
  dropLine = null,
  readOnly = false,
}: Props): React.ReactElement {
  // В режиме выделения карточка не таскается и не открывает дравер — клик тогает выбор.
  const selecting = selectionMode && !preview;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'task', task },
    disabled: preview || selecting || readOnly,
    transition: DND_TRANSITION,
  });

  // Reorder-transform от dnd-kit НЕ применяем к карточкам: соседи не должны
  // раздвигаться/дёргаться при drag (Notion — карточки стоят, место дропа = синяя
  // полоска). Перетаскиваемую заменяет пилюля-оверлей, исходная остаётся opacity-30
  // на месте. transition тоже убираем — анимировать нечего. Оставляем _unused, чтобы
  // не ловить ошибку линта на неиспользуемые деструктурированные значения.
  void transform;
  void transition;
  const style: React.CSSProperties = {};

  // motion.div снаружи — обрабатывает layout-переходы между колонками (auto-transition
  // после Sync commits, ручной link и пр.). dnd-kit'овский transform — отдельный inline-style
  // на inner div, не конфликтует с motion'овским layout-уровнем.
  // Для preview-варианта (DragOverlay) motion-обёртка отключена — иначе два элемента с одним
  // layoutId. На тач-устройствах (IS_COARSE_POINTER) тоже отключаем — layout-анимация карточек
  // на мобиле только жрёт кадры при скролле, визуально она там почти не нужна.
  const Wrapper = preview || IS_COARSE_POINTER ? PassthroughWrapper : MotionWrapper;

  // Гасим mousedown/touchstart на actions, чтобы нажатие по Edit/Delete/чекбоксу не
  // стартовало drag через активаторы dnd-kit (MouseSensor/TouchSensor) на родителе.
  const stopDrag = (e: React.SyntheticEvent): void => e.stopPropagation();
  const stopDragProps = { onMouseDown: stopDrag, onTouchStart: stopDrag };

  // Прогресс GFM-чеклиста из описания — бейдж «3/7» в мета-строке.
  const checklist = task.description ? checklistProgress(task.description) : null;

  // Заголовок (первая строка) рендерим plain-текстом, тело — markdown (см. TaskTitleText).
  const { title, body } = splitTitleBody(task.description ?? '');

  // Есть ли что показывать в нижнем мета-оверлее. Если нет (простая однострочная задача) —
  // не затемняем текст и не рисуем пустую градиент-полосу на hover; кнопки действий
  // (корзина/стрелка) сами маскируют свой угол сплошным фоном.
  const hasMeta = Boolean(
    task.assignee ||
      checklist ||
      (task.commentCount ?? 0) > 0 ||
      (task.attachmentCount ?? 0) > 0 ||
      (task.ralphMode && task.ralphMode !== 'normal') ||
      task.deadline ||
      task.status === 'in_progress' ||
      task.status === 'awaiting_clarification',
  );

  // Выполненная задача — зелёный хайрлайн-маркер готовности. Заливки НЕТ: по замерам Notion
  // карточка не залитая плашка, а белая карточка на цветном кольце колонки.
  const doneCard = !preview && task.status === 'done';

  // Цель «шага вперёд» для кнопки на hover: Черновики→Вручную, Вручную→Воркер, Воркер→Готово.
  // null (напр. в «Готово») — кнопку не показываем.
  const promoteNext = onQuickPromote ? quickPromoteNext(task.status) : null;

  // Есть ли вообще кнопки действий на карточке.
  const showActions = !readOnly && !selecting && !preview;

  // Кнопки действий рендерятся в ДВУХ раскладках: десктоп — плавающий оверлей в правом
  // верхнем углу (по hover), мобила — статичный ряд, прижатый под текстом (всегда виден).
  // big=true → тач-размер (size-9), иначе компактный десктопный (size-6).
  const renderActions = (big: boolean): React.ReactNode =>
    showActions ? (
      <>
        {showCheckbox && (
          <InboxCheckbox
            task={task}
            lastDoneTaskId={lastDoneTaskId}
            lastTodoTaskId={lastTodoTaskId}
            onChanged={onTaskChanged}
            variant="toolbar"
          />
        )}
        {onQuickPromote && promoteNext && (
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'group/promote shrink-0 cursor-pointer rounded text-muted-foreground hover:bg-hover hover:text-foreground',
              big ? 'size-9' : 'size-6',
            )}
            onClick={(e) => {
              e.stopPropagation();
              onQuickPromote(task);
            }}
            aria-label={`Передать в «${STATUS_LABEL[promoteNext]}»`}
            title={`Передать в «${STATUS_LABEL[promoteNext]}»`}
          >
            <ArrowRight
              className={cn(
                'transition-transform duration-150 group-hover/promote:translate-x-0.5',
                big ? 'size-4' : 'size-3',
              )}
            />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'shrink-0 cursor-pointer rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
            big ? 'size-9' : 'size-6',
          )}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(task);
          }}
          aria-label="Удалить"
        >
          <Trash2 className={big ? 'size-4' : 'size-3'} />
        </Button>
      </>
    ) : null;

  // Мета-бейджи (ответственный / чеклист / комменты / дедлайн / статус). Десктоп — нижний
  // левый оверлей (по hover), мобила — тот же контент в статичном нижнем ряду.
  const metaInner = hasMeta ? (
    <span className="flex min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden">
      <AssigneeBadge assignee={task.assignee} />
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
  ) : null;

  return (
    <Wrapper layoutId={task.id}>
      <div
        ref={setNodeRef}
        data-pf-task-id={task.id}
        style={style}
        {...(selecting || readOnly ? {} : attributes)}
        {...(selecting || readOnly ? {} : listeners)}
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
        onKeyDown={(e) => {
          // Клавиатурная активация (U4): карточка — role="button", но без onKeyDown
          // её нельзя было открыть с клавиатуры (WCAG 2.1.1). Enter/Space = клик.
          if (preview) return;
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          if (selecting) {
            onSelectToggle?.(task.id, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
            return;
          }
          onEdit(task);
        }}
        role="button"
        // В режиме выделения dnd-attributes (с их tabIndex) сняты — возвращаем фокусируемость.
        tabIndex={selecting ? 0 : undefined}
        aria-pressed={selecting ? selected : undefined}
        className={cn(
          // НЕ ставим touch-action:none — иначе палец не сможет скроллить колонку/доску
          // (любое касание карточки превращалось бы в drag). Long-press TouchSensor (~220мс)
          // сам отличает скролл от переноса.
          // Notion-style компактная карточка: минимальный отступ (px-2 py-1.5), без
          // лишнего «воздуха». При hover — только маленькая корзина (оверлей ниже).
          // Мобила — колонка (текст сверху, ряд мета/действий снизу); десктоп — как было
          // (строка: чекбокс + текст, действия/мета плавающими оверлеями).
          'group relative flex select-none flex-col gap-1.5 rounded-[10px] border border-transparent bg-card px-2 py-1.5 outline-none sm:flex-row sm:items-start',
          // Ключ к «нотионовскому» виду доски: карточка НЕ залита цветом колонки, а белая
          // (bg-card) и приподнята над её слабой тонировкой. Отделяют её не бордер, а две
          // мягкие тени + третий слой — цветное кольцо в 1px. Цвет кольца отдаёт колонка
          // через --pf-card-ring (KanbanColumn), фолбэк — нейтральный: карточку могут
          // отрисовать и вне доски. Бордер оставлен ПРОЗРАЧНЫМ намеренно — хайрлайн теперь
          // рисует кольцо, но модификаторы ниже (done / open / selected / приоритет)
          // продолжают красить бордер ровно как раньше.
          'shadow-[0_4px_12px_rgba(25,25,25,0.027),0_1px_2px_rgba(25,25,25,0.02),0_0_0_1px_var(--pf-card-ring,rgba(42,28,0,0.07))]',
          // На графите мягкая светлая тень не читается — в тёмной теме тени плотнее,
          // а кольцо, наоборот, светлое.
          'dark:shadow-[0_4px_12px_rgba(0,0,0,0.28),0_1px_2px_rgba(0,0,0,0.2),0_0_0_1px_var(--pf-card-ring,rgba(255,255,255,0.09))]',
          // Базовый transition только для тех свойств, которые меняем CSS-ом —
          // transform трогать НЕ нужно, им рулит dnd-kit (см. inline style выше).
          'transition-[border-color,opacity,background-color] duration-150 ease-out',
          // Done-карточка: только зелёный хайрлайн, БЕЗ заливки. Заливка тем же цветом, что
          // и колонка, — ровно то, от чего уходит редизайн (замеры Notion §4: белая карточка
          // на цветном кольце). Побочно: плашки мета/действий на hover'е красятся сплошным
          // bg-card, и на незалитой карточке они наконец сходятся с ней в цвете.
          doneCard && 'border-success/25 hover:border-success/45',
          // Priority-accent: цветной левый кант (2px, rose/orange/blue/slate) —
          // спокойный индикатор важности в стиле Todoist (меняется в дравере).
          task.priority && cn('border-l-2', PRIORITY_META[task.priority].border),
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          // Status-акцент: TODO — статичный тонкий янтарный ring «задача ждёт воркера».
          // Стоит ДО selection-ring ниже, чтобы при выделении twMerge оставил ring выбора.
          !preview && task.status === 'todo' && 'ring-1 ring-amber-400/40 dark:ring-amber-300/20',
          // Подсветка выбранной карточки в режиме выделения.
          selecting && selected && 'border-primary ring-2 ring-primary/60',
          // E4: открыта в drawer'е — слегка синяя заливка + синий бордер (как в Notion).
          open && !preview && 'border-primary/60 bg-primary/[0.04] dark:bg-primary/[0.08]',
          // E4: только что перемещена drag'ом — выделена синим (держится до клика в стороне).
          recentlyMoved && !preview && 'border-primary ring-2 ring-primary/60',
          preview
            ? // Карточка в DragOverlay: «приподнятый» вид — мощная тень, ring, выраженная
              // граница. Tilt/scale делаем НЕ здесь, а на motion-обёртке в KanbanBoard —
              // иначе CSS-transform запекается в snapshot DragOverlay и при drop остаётся
              // «висеть наклонённым», пока внешний transform лерпится к месту.
              // dark:shadow-2xl обязателен: базовая тень объявлена и в dark:-варианте, а он
              // специфичнее одиночного shadow-2xl — без него в тёмной теме оверлей остался
              // бы с обычной тенью карточки.
              'cursor-grabbing border-foreground/30 shadow-2xl ring-2 ring-primary/20 dark:shadow-2xl'
            : // На hover'е карточка кликабельна (открывает диалог) → cursor-pointer.
              // grabbing включается только когда юзер реально потащил (isDragging ниже).
              'cursor-pointer',
          // Оригинал на месте, пока тащим preview — делаем призрачным и меняем курсор
          // на grabbing (юзер визуально taskает оверлей, но если случайно нависнет на
          // оригинале — курсор не сбивается обратно на pointer).
          isDragging && !preview && 'cursor-grabbing opacity-30',
        )}
      >
        {/* Индикатор дропа (Notion): синяя полоска В ЗАЗОРЕ над/под карточкой.
            Абсолютная (zero-layout) — соседи НЕ раздвигаются, линия не задевает
            карточки, просто появляется между ними (запрос: «не дёргать задачи»). */}
        {dropLine && !preview && (
          <span
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-x-1 z-30 flex items-center gap-1',
              dropLine === 'before' ? '-top-[5px]' : '-bottom-[5px]',
            )}
          >
            <span className="size-1.5 shrink-0 rounded-full bg-primary" />
            <span className="h-0.5 flex-1 rounded-full bg-primary shadow-[0_0_6px_rgba(59,130,246,0.5)]" />
            <span className="size-1.5 shrink-0 rounded-full bg-primary" />
          </span>
        )}
        {/* 🔴 LIVE-индикатор: воркер прямо сейчас работает над задачей (есть running-сессия).
            На hover прячем — там всплывают кнопки действий в том же углу. */}
        {liveRunning && !preview && (
          <span
            aria-label="Воркер работает над задачей"
            title="Воркер работает над задачей"
            className="absolute right-1.5 top-1.5 z-10 size-2 animate-pulse rounded-full bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.7)] transition-opacity group-hover:opacity-0 group-focus-within:opacity-0"
          />
        )}

        {/* Действия — ДЕСКТОП: плавающий оверлей в правом верхнем углу (по hover/focus).
            На мобиле скрыт (max-sm:hidden) — там действия в статичном нижнем ряду (ниже),
            чтобы не перекрывать текст задачи. Сплошной bg-card маскирует текст под кнопками.
            top-4 + -translate-y-1/2: центр плашки садится на центр ПЕРВОЙ строки. */}
        {showActions && (
          <div
            className="pointer-events-none absolute right-2 top-4 z-20 hidden -translate-y-1/2 items-center gap-0.5 rounded-md bg-card opacity-0 shadow-sm ring-1 ring-black/[0.06] transition-opacity duration-150 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 sm:flex dark:ring-white/[0.08]"
            {...stopDragProps}
          >
            {renderActions(false)}
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
        ) : null}
        <div className="min-w-0 flex-1">
          {/* Текст карточки НЕ затемняем: мета/действия всплывают как локальные плашки со
              своим фоном (снизу-слева и сверху-справа), маскируя только свою область. */}
          <div>
            {task.description?.trim() ? (
              // На мобиле показываем ВЕСЬ текст задачи (line-clamp-none): на телефоне карточка
              // и так почти во всю ширину, обрезать нечего — юзер хочет читать задачу целиком.
              // На десктопе оставляем компактный клэмп в 4 строки.
              <div className="line-clamp-4 max-sm:line-clamp-none text-sm leading-snug">
                {/* Иконка задачи (эмодзи/lucide/картинка) — перед заголовком, как в Notion. */}
                {task.icon && (
                  <span className="mr-1 inline-grid size-[1.05rem] shrink-0 translate-y-[3px] place-items-center overflow-hidden">
                    <ProjectIconView icon={task.icon} pixelSize={17} className="text-[1.05rem]" />
                  </span>
                )}
                {/* Заголовок — plain-текст (не markdown), чтобы `---`/`- `/`* `/`# ` в начале
                    не превращались в hr/список/heading и не пропадали под COMPACT-пресетом.
                    На доске заголовок держим полужирным (font-medium) — так карточка читается
                    «названием сверху», как в Notion; в списке/панели вес обычный. */}
                <TaskTitleText title={title} className="font-medium text-foreground" />
                {body.trim() && (
                  <Markdown
                    className={cn(
                      MARKDOWN_COMPACT,
                      '[&_h1]:font-normal [&_h2]:font-normal [&_h3]:font-normal [&_h4]:font-normal',
                      '[&_strong]:font-normal [&_b]:font-normal',
                    )}
                  >
                    {body}
                  </Markdown>
                )}
              </div>
            ) : (
              <p className="text-sm leading-snug text-muted-foreground">—</p>
            )}
          </div>
        </div>
        {/* Мета (чеклист/комменты/дедлайн/статус…) — ЛОКАЛЬНАЯ плашка снизу-слева со своим
            сплошным фоном: маскирует только область под самими бейджами, текст карточки не
            затемняется. Симметрична плашке действий сверху-справа. Не занимает высоту (absolute),
            прячется в режиме выделения и drag-preview. pointer-events-none — чтобы невидимая
            (opacity-0) плашка не перехватывала mousedown и не мешала начать drag. */}
        {/* Мета — ДЕСКТОП: нижний левый оверлей (по hover). На мобиле скрыт (hidden),
            вместо него — статичный ряд ниже. */}
        {!selecting && !preview && hasMeta && (
          <div
            className={cn(
              // Нейтральный bg-card + ring — один в один как плашка действий сверху-справа
              // (она нормально смотрится на любой карточке, включая зелёную done).
              'pointer-events-none absolute bottom-1 left-1 hidden max-w-[calc(100%-0.5rem)] items-center gap-1.5 overflow-hidden rounded-md bg-card px-1.5 py-0.5 text-[11px] text-muted-foreground opacity-0 shadow-sm ring-1 ring-black/[0.06] transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 sm:flex dark:ring-white/[0.08]',
            )}
          >
            {metaInner}
          </div>
        )}

        {/* Мета/действия — МОБИЛА: статичный ряд, прижатый ПОД текстом задачи. Всегда виден
            (не по hover), крупные кнопки, текст выше виден целиком. На десктопе скрыт (sm:hidden).
            border-t мягко отделяет ряд от текста. */}
        {!selecting && !preview && (hasMeta || showActions) && (
          <div
            className="mt-0.5 flex items-center justify-between gap-2 border-t border-black/[0.05] pt-1 text-[11px] text-muted-foreground sm:hidden dark:border-white/[0.06]"
            {...stopDragProps}
          >
            <span className="flex min-w-0 flex-1 items-center overflow-hidden">{metaInner}</span>
            {showActions && <span className="flex shrink-0 items-center gap-1">{renderActions(true)}</span>}
          </div>
        )}
      </div>
    </Wrapper>
  );
}

// React.memo: доска часто ре-рендерится (фильтры, refetch, выделение), но конкретная карточка
// меняется редко. Без memo перерисовывались ВСЕ карточки колонки разом (+ пересчёт layout у
// каждого motion.div) — ключевой источник лагов. Коллбеки из KanbanBoard стабильны (useCallback),
// task-ссылки стабильны между несвязанными рендерами → shallow-compare реально отсекает работу.
export const KanbanCard = memo(KanbanCardImpl);

function MotionWrapper({
  layoutId,
  children,
}: {
  layoutId: string;
  children: React.ReactNode;
}): React.ReactElement {
  // Пока тянут ручку левой панели — layout-анимацию выключаем: иначе карточки «плывут»
  // пружиной за колонками на каждом шаге ресайза и «висят в воздухе» до отпускания.
  const resizing = useSidebarResizing();
  // Тумблер анимаций выключен (или системный reduced-motion) → layout-анимацию тоже гасим:
  // CSS pf-no-motion не глушит framer-motion layout (он на JS-transform), поэтому гейтим здесь.
  const { animations } = useMotion();
  return (
    <motion.div
      layout={resizing || !animations ? false : 'position'}
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
