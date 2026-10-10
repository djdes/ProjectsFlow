import { memo, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { motion } from 'motion/react';
import { useSidebarResizing } from '@/presentation/layout/sidebarResizingContext';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { ArrowRight, Check, ImageIcon, ListChecks, MessageSquare, Trash2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { SelectModifiers } from './selection/selectionReducer';
import { Markdown } from '@/presentation/components/markdown/Markdown';
import { TASK_CARD_BODY_CLASS, taskCardTitleClass } from './taskCardText';
import { TaskTitleText } from './TaskTitleText';
import { splitTitleBody } from '@/lib/taskTitleBody';
import { ProjectIconView } from '@/presentation/components/project/projectIconView';
import type { Task } from '@/domain/task/Task';
import type { MoveTaskInput } from '@/application/task/TaskRepository';
import { ClaudeIcon } from './ClaudeIcon';
import { AssigneeBadge } from './AssigneeBadge';
import { InboxCheckbox } from './InboxCheckbox';
import { RalphModeBadge } from './RalphMode';
import { DeadlineBadge } from './DeadlineBadge';
import { PriorityBadge } from './PriorityBadge';
import { TASK_TYPE_META } from '@/domain/task/taskTypeMeta';
import { checklistProgress } from '@/lib/checklist';
import { STATUS_LABEL, quickPromoteNext } from './statusLabels';
import { useWorkspaces } from '@/presentation/hooks/useWorkspaces';
import { useUnreadTasks } from '@/presentation/hooks/UnreadTasksProvider';
import { useWorkerEnabled } from '@/presentation/hooks/useWorkerEnabled';
import { useCompletedToday } from '@/presentation/hooks/CompletedTodayProvider';
import { useContainer } from '@/infrastructure/di/container';
import { toast } from '@/components/ui/sonner';

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
  // Оптимистичный useTasks().move родителя. Прокидывается в чекбокс «выполнено»/«принять
  // работу», чтобы карточка переезжала между колонками доски мгновенно, как при drag,
  // а не только после onTaskChanged→refetch (см. InboxCheckbox.move).
  onMove?: (taskId: string, input: MoveTaskInput) => Promise<void>;
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
  // Отключить layout-анимацию motion'а. Нужно там, где карточка живёт вне колонок —
  // например в полке «В работе»: там анимация позиции ничего не даёт, а её трансформ
  // после переезда карточки остаётся висеть, и карточки наезжают друг на друга.
  disableLayoutAnimation?: boolean;
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
  onMove,
  liveRunning = false,
  open = false,
  recentlyMoved = false,
  selectionMode = false,
  selected = false,
  onSelectToggle,
  currentUserId = null,
  dropLine = null,
  readOnly = false,
  disableLayoutAnimation = false,
}: Props): React.ReactElement {
  // Роль в активном пространстве: ею решаем, показывать ли «выполнено» на задаче,
  // которая уже ждёт приёмки (см. checkboxVisible ниже).
  const { data: workspaces } = useWorkspaces();
  // Приёмка (db/150): задача уже отправлена на утверждение.
  const awaitingApproval = task.status === 'pending_approval';
  const currentWorkspace = (workspaces ?? []).find((w) => w.isCurrent) ?? null;
  const canApproveWork =
    currentWorkspace?.role === 'lead' || currentWorkspace?.role === 'owner';
  // Задача заморожена: ждёт приёмки, а актор её не принимает. Драг и удаление отключаем —
  // сервер такие операции отклоняет (409), и кнопка, которая заведомо упадёт, хуже её
  // отсутствия. Открыть и читать задачу при этом можно. Объявлено ДО useSortable: хук
  // читает флаг в своих опциях (иначе TDZ — «used before declaration»).
  const frozenByApproval = awaitingApproval && !canApproveWork;
  const { isUnread } = useUnreadTasks();
  // Воркер выключен в пространстве — «шаг вперёд» не должен целиться в исчезнувшую колонку.
  const workerEnabled = useWorkerEnabled();
  const { forget: forgetCompleted } = useCompletedToday();
  // Отзыв с утверждения прямо с карточки: отправил по ошибке — забрал, не открывая задачу.
  // Кнопка только у ответственного: остальным сервер откажет, и обещать её нельзя.
  const { taskRepository } = useContainer();
  const [withdrawing, setWithdrawing] = useState(false);
  const canWithdraw = frozenByApproval && !!currentUserId && task.assignee.userId === currentUserId;
  const withdraw = async (): Promise<void> => {
    if (withdrawing) return;
    setWithdrawing(true);
    try {
      await taskRepository.withdrawApproval(task.projectId, task.id);
      // Задача вернулась в работу — в рейтинге ей больше не место.
      forgetCompleted(task.id);
      toast.success('Задача снова в работе');
      onTaskChanged?.();
    } catch (e) {
      toast.error(`Не удалось забрать: ${(e as Error).message}`);
    } finally {
      setWithdrawing(false);
    }
  };
  // В режиме выделения карточка не таскается и не открывает дравер — клик тогает выбор.
  const selecting = selectionMode && !preview;
  // Непрочитанная задача: назначена на меня и я её ещё не открывал. Гаснет при открытии
  // (см. UnreadTasksProvider и TaskDrawer). ПОСЛЕ `selecting` — иначе TDZ.
  const unread = !preview && !selecting && isUnread(task.id);
  // Срочный приоритет — красное свечение. Перебивает синее «непрочитано»: два ореола на
  // одной карточке спорят друг с другом, а «сделай сейчас» важнее, чем «посмотри».
  const urgent = !preview && !selecting && task.priority === 1;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'task', task },
    disabled: preview || selecting || readOnly || frozenByApproval,
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
  const Wrapper =
    preview || IS_COARSE_POINTER || disableLayoutAnimation ? PassthroughWrapper : MotionWrapper;

  // Гасим mousedown/touchstart на actions, чтобы нажатие по Edit/Delete/чекбоксу не
  // стартовало drag через активаторы dnd-kit (MouseSensor/TouchSensor) на родителе.
  const stopDrag = (e: React.SyntheticEvent): void => e.stopPropagation();
  const stopDragProps = { onMouseDown: stopDrag, onTouchStart: stopDrag };

  // Прогресс GFM-чеклиста из описания — бейдж «3/7» в мета-строке.
  const checklist = task.description ? checklistProgress(task.description) : null;

  // The first line uses safe inline Markdown; the body supports block Markdown.
  const { title, body } = splitTitleBody(task.description ?? '');

  // Ответственного показываем, когда это не вы: на своей доске свой аватар на каждой
  // карточке — шум (дизайн C4: «кто» — только когда это кто-то другой).
  const showAssignee = !currentUserId || task.assignee.userId !== currentUserId;
  // Есть ли что показывать в нижней строке мета. Нет — строки нет вовсе (простая задача
  // остаётся карточкой из одного заголовка).
  const hasMeta = Boolean(
    showAssignee ||
      checklist ||
      (task.commentCount ?? 0) > 0 ||
      (task.attachmentCount ?? 0) > 0 ||
      (task.ralphMode && task.ralphMode !== 'normal') ||
      task.taskType ||
      task.priority ||
      task.deadline ||
      task.status === 'in_progress' ||
      task.status === 'awaiting_clarification',
  );

  // Выполненная задача — зелёный хайрлайн-маркер готовности. Заливки НЕТ: по замерам Notion
  // карточка не залитая плашка, а белая карточка на цветном кольце колонки.
  const doneCard = !preview && task.status === 'done';

  // Цель «шага вперёд» для кнопки на hover: Черновики→Вручную, Вручную→Воркер, Воркер→Готово.
  // null (напр. в «Готово») — кнопку не показываем.
  const promoteNext = onQuickPromote ? quickPromoteNext(task.status, workerEnabled) : null;
  // Исполнителю кнопка «выполнено» на задаче в очереди приёмки бесполезна — сервер вернёт
  // ту же очередь, и ничего не произойдёт. Оставляем её только принимающему: для него это
  // и есть «принять работу». (awaitingApproval/canApproveWork объявлены выше — их читает
  // useSortable.)
  const checkboxVisible = showCheckbox && (!awaitingApproval || canApproveWork);

  // Есть ли вообще кнопки действий на карточке.
  const showActions = !readOnly && !selecting && !preview;

  // Кнопки действий рендерятся в ДВУХ раскладках: десктоп — плавающий оверлей в правом
  // верхнем углу (по hover), мобила — статичный ряд, прижатый под текстом (всегда виден).
  // big=true → тач-размер (size-9), иначе компактный десктопный (size-6).
  const renderActions = (big: boolean): React.ReactNode =>
    showActions ? (
      <>
        {checkboxVisible && (
          <InboxCheckbox
            task={task}
            lastDoneTaskId={lastDoneTaskId}
            lastTodoTaskId={lastTodoTaskId}
            onChanged={onTaskChanged}
            variant="toolbar"
            doneTitle={awaitingApproval ? 'Принять работу' : undefined}
            move={onMove ? (input) => onMove(task.id, input) : undefined}
          />
        )}
        {onQuickPromote && promoteNext && (
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'group/promote shrink-0 cursor-pointer rounded-[5px] text-muted-foreground hover:bg-hover hover:text-foreground',
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
                'motion-safe:transition-transform duration-150 group-hover/promote:translate-x-0.5',
                big ? 'size-4' : 'size-3',
              )}
            />
          </Button>
        )}
        {canWithdraw && (
          <Button
            variant="ghost"
            size="icon"
            disabled={withdrawing}
            className={cn(
              'shrink-0 cursor-pointer rounded-[5px] text-muted-foreground hover:bg-hover hover:text-foreground',
              big ? 'size-9' : 'size-6',
            )}
            onClick={(e) => {
              e.stopPropagation();
              void withdraw();
            }}
            aria-label="Забрать с утверждения"
            title="Забрать с утверждения и продолжить работу"
          >
            <Undo2 className={big ? 'size-4' : 'size-3'} />
          </Button>
        )}
        {!frozenByApproval && (
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'shrink-0 cursor-pointer rounded-[5px] text-muted-foreground hover:bg-hover hover:text-destructive',
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
        )}
      </>
    ) : null;

  // Мета-бейджи (срок / приоритет / чеклист / комменты / статус / ответственный) — нижняя
  // строка карточки, видна всегда (дизайн C4: «снизу — срок и счётчики»).
  const metaInner = hasMeta ? (
    <span className="flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-hidden">
      {task.deadline && <DeadlineBadge deadline={task.deadline} status={task.status} />}
      {task.priority ? <PriorityBadge priority={task.priority} /> : null}
      {checklist && (
        <span
          className={cn(
            'flex shrink-0 items-center gap-1 whitespace-nowrap tabular-nums',
            checklist.done === checklist.total && 'text-done',
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
      {/* Тип задачи (db/153). Показываем только когда он определён — «без типа» это
          нормальное состояние большинства задач, и плашка про него была бы шумом. */}
      {task.taskType && (
        <span
          className={cn(
            'shrink-0 whitespace-nowrap rounded px-1.5 py-px font-medium',
            TASK_TYPE_META[task.taskType].badge,
          )}
        >
          {TASK_TYPE_META[task.taskType].label}
        </span>
      )}
      {/* «В работе» у воркера — синий, цвет очереди и агента (дизайн C4). */}
      {task.status === 'in_progress' && (
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap font-medium text-primary-ink">
          <span aria-hidden className="size-1.5 rounded-full bg-primary" />
          {STATUS_LABEL.in_progress}
        </span>
      )}
      {task.status === 'awaiting_clarification' && (
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap font-medium text-warning">
          <ClaudeIcon className="size-3" />
          {STATUS_LABEL.awaiting_clarification}
        </span>
      )}
      {showAssignee && (
        <span className="ms-auto flex shrink-0 items-center">
          <AssigneeBadge assignee={task.assignee} />
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
          // Компактная карточка на десктопе; на телефоне чуть больше отступы для чтения.
          // При hover — только маленькая корзина (оверлей ниже).
          // Мобила — колонка (текст сверху, ряд мета/действий снизу); десктоп — как было
          // (строка: чекбокс + текст, действия/мета плавающими оверлеями).
          // Дизайн C4: плотная карточка — радиус 8px, отступы 7×10px (на телефоне чуть больше
          // для чтения), заголовок 13.5px.
          'group relative flex select-none flex-col gap-1.5 rounded-lg border border-transparent bg-card px-3 py-2.5 outline-none sm:flex-row sm:items-start sm:px-2.5 sm:py-[7px]',
          // Карточка НЕ залита цветом колонки, а белая (bg-card) над серым листом колонки.
          // Отделяет её кольцо 1px + мягкая тень (светлая тема) или линия (тёмная). Цвет
          // кольца отдаёт колонка через --pf-card-ring (KanbanColumn), фолбэк — нейтральный:
          // карточку могут отрисовать и вне доски. Бордер ПРОЗРАЧНЫЙ: модификаторы ниже
          // (done / open / selected) красят именно его.
          'shadow-[0_0_0_1px_var(--pf-card-ring,oklch(16.84%_0_none/0.08)),0_1px_3px_oklch(16.84%_0_none/0.06)]',
          'dark:shadow-[0_0_0_1px_var(--pf-card-ring,oklch(31.05%_0.015_274.41))]',
          // Наведение: светлая — глубже тень, тёмная — карточка чуть светлеет.
          !preview && 'hover:shadow-card-hover dark:hover:bg-card-hover dark:hover:shadow-card-hover',
          // Базовый transition только для тех свойств, которые меняем CSS-ом —
          // transform трогать НЕ нужно, им рулит dnd-kit (см. inline style выше).
          'transition-[border-color,opacity,background-color,box-shadow] duration-150 ease-out',
          // Done-карточка: только зелёный хайрлайн, БЕЗ заливки. Заливка тем же цветом, что
          // и колонка, — ровно то, от чего уходит редизайн (замеры Notion §4: белая карточка
          // на цветном кольце). Побочно: плашки мета/действий на hover'е красятся сплошным
          // bg-card, и на незалитой карточке они наконец сходятся с ней в цвете.
          doneCard && 'border-success/25 hover:border-success/45',
          // Приоритет — флажком в нижней строке, а не цветной полосой слева (дизайн C4: без
          // полос-рамок; цвет живёт в метке).
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          // Непрочитанная: синий неон по контуру. Стоит ДО состояний выбора/открытия —
          // те временные и должны перебивать подсветку, а не спорить с ней.
          unread && !urgent && 'pf-unread',
          // Срочная: красное свечение, сильнее непрочитанного.
          urgent && 'pf-urgent',
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
              dropLine === 'before' ? '-inset-bs-[5px]' : '-inset-be-[5px]',
            )}
          >
            <span className="size-1.5 shrink-0 rounded-full bg-primary" />
            <span className="h-0.5 flex-1 rounded-full bg-primary shadow-[0_0_6px_oklch(62.31%_0.188_259.81/0.5)]" />
            <span className="size-1.5 shrink-0 rounded-full bg-primary" />
          </span>
        )}
        {/* 🔴 LIVE-индикатор: воркер прямо сейчас работает над задачей (есть running-сессия).
            На hover прячем — там всплывают кнопки действий в том же углу. */}
        {liveRunning && !preview && (
          <span
            aria-label="Воркер работает над задачей"
            title="Воркер работает над задачей"
            className="absolute end-1.5 inset-bs-1.5 z-10 size-2 rounded-full bg-destructive shadow-[0_0_6px_oklch(var(--destructive)/0.7)] transition-opacity group-hover:opacity-0 group-focus-within:opacity-0 motion-safe:animate-pulse"
          />
        )}

        {/* Действия — ДЕСКТОП: плашка быстрых действий в правом верхнем углу (по hover/focus),
            та же, что на карточках «Входящих». На мобиле скрыта — там действия в нижнем ряду. */}
        {showActions && (
          <div
            className="pointer-events-none absolute end-[5px] inset-bs-[5px] z-20 hidden items-center gap-px rounded-[7px] bg-raised p-0.5 opacity-0 shadow-[0_2px_6px_oklch(16.84%_0_none/0.08)] ring-1 ring-border transition-opacity duration-150 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 sm:flex dark:shadow-none"
            {...stopDragProps}
          >
            {renderActions(false)}
          </div>
        )}
        {selecting ? (
          <span
            aria-hidden
            className={cn(
              'mbs-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 transition-colors',
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
              <div className="max-h-[calc(4lh+0.25rem)] overflow-hidden text-task leading-snug max-sm:max-h-none">
                {/* Иконка задачи (эмодзи/lucide/картинка) — перед заголовком, как в Notion. */}
                {task.icon && (
                  <span className="me-1 inline-grid size-[1.05rem] shrink-0 translate-y-[3px] place-items-center overflow-hidden">
                    <ProjectIconView icon={task.icon} pixelSize={17} className="text-[1.05rem]" />
                  </span>
                )}
                {/* Keep authored inline marks; list/rule-like title prefixes stay literal. */}
                <TaskTitleText title={title} className={taskCardTitleClass(title)} authoredBold />
                {body.trim() && <Markdown className={TASK_CARD_BODY_CLASS}>{body}</Markdown>}
              </div>
            ) : (
              <p className="text-task leading-snug text-muted-foreground">—</p>
            )}
          </div>
          {/* Нижняя строка — срок, приоритет, счётчики, ответственный (если не вы). Видна
              всегда, в потоке под текстом; в drag-превью — тоже, карточка узнаётся целиком.
              На телефоне справа в ней же — кнопки действий (там нет наведения). */}
          {!selecting && (hasMeta || showActions) && (
            <div
              className={cn(
                'flex min-w-0 items-center gap-2 pbs-1.5 text-2xs text-muted-foreground',
                // Без мета строка нужна только ради кнопок телефона.
                !hasMeta && 'sm:hidden',
              )}
            >
              {metaInner ?? <span className="flex-1" />}
              {showActions && (
                <span className="flex shrink-0 items-center gap-0.5 sm:hidden" {...stopDragProps}>
                  {renderActions(true)}
                </span>
              )}
            </div>
          )}
        </div>
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
