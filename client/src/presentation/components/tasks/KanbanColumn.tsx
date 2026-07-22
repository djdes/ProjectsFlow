import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, type SortingStrategy } from '@dnd-kit/sortable';

// Notion-style drag: карточки НЕ раздвигаются/не дёргаются при перетаскивании — место
// дропа показывает только синяя полоска (DropIndicatorLine). Стратегия без сдвигов —
// возвращает null для всех соседей (dnd-kit не применяет transform реордера).
const noReflowStrategy: SortingStrategy = () => null;
import { FileText, ListChecks, PanelRight, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { RalphMode, Task, TaskPriority, TaskStatus } from '@/domain/task/Task';
import { cn } from '@/lib/utils';
import { KanbanCard } from './KanbanCard';
import { ColumnMoreButton, useColumnPreview } from './ColumnPreview';
import { TaskComposer } from './TaskComposer';
import { IconPicker } from '@/presentation/components/project/IconPicker';
import { ProjectIconView } from '@/presentation/components/project/projectIconView';
import { STATUS_SUBTITLE } from './statusLabels';
import type { SelectModifiers } from './selection/selectionReducer';

type PinnedHeader = {
  left: number;
  top: number;
  width: number;
  height: number;
  clipLeft: number;
  clipRight: number;
};

function samePinnedHeader(left: PinnedHeader | null, right: PinnedHeader | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.left === right.left && left.top === right.top && left.width === right.width &&
    left.height === right.height && left.clipLeft === right.clipLeft && left.clipRight === right.clipRight;
}

// Bottom of the whole columns row (the tallest column), in viewport coords. Children of
// the board scroller are the columns themselves, so the lowest of their bottoms is where
// the board content really ends — the scroller's own rect would add its bottom padding.
function columnsRowBottom(scroller: HTMLElement, fallback: number): number {
  let bottom = fallback;
  const children = scroller.children;
  for (let i = 0; i < children.length; i += 1) {
    const childBottom = children[i]!.getBoundingClientRect().bottom;
    if (childBottom > bottom) bottom = childBottom;
  }
  return bottom;
}

function scrollParents(element: HTMLElement): Array<HTMLElement | Window> {
  const parents: Array<HTMLElement | Window> = [window];
  let current = element.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    if (/(?:auto|scroll|overlay)/u.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)) parents.push(current);
    current = current.parentElement;
  }
  return [...new Set(parents)];
}

export type KanbanColumnColorClasses = {
  // Залитая пилюля вокруг названия колонки: фон + цвет текста (Notion-стиль).
  readonly pill: string;
  // Тонировка колонки целиком — шапка и тело единым блоком, один фон на оба.
  readonly body: string;
  // Точка 8×8 внутри пилюли (она же свотч в пикере цветов).
  readonly dot: string;
  // Класс, объявляющий --pf-card-ring — цветное кольцо карточек этой колонки.
  // Карточка читает переменную сама (KanbanCard), знать про колонку ей не нужно.
  readonly ring: string;
  // Цвет текста «пустой карточки» внизу колонки — кнопки «Создать задачу» (Notion §5b).
  readonly action: string;
};

// Фолбэк-тонировка колонки, когда цвет не передан. Живёт отдельной константой, потому что
// её обязана повторить ОТКРЕПЛЁННАЯ шапка: position:fixed уносит её из колонки, и подложку
// (страница + тонировка) она докрашивает сама — иначе на стыке видна полоса другого тона.
const DEFAULT_COLUMN_TINT = 'bg-[rgba(55,53,47,0.03)] dark:bg-[rgba(255,255,255,0.045)]';

type InlineCreateInput = {
  description: string;
  status?: TaskStatus;
  icon?: string | null;
  // Позиция: поставить сразу ПОСЛЕ этой задачи (цепочка inline-создания, порядок создания).
  afterTaskId?: string | null;
  ralphMode?: RalphMode;
  assigneeUserId?: string;
  deadline?: string | null;
  priority?: TaskPriority | null;
};

type Props = {
  status: TaskStatus;
  // Пустая строка ⇒ хедер без названия (backlog-колонка). Счётчик и `+` остаются.
  label: string;
  // Верхний офсет для sticky-шапки колонки (Notion: заголовки липнут при скролле).
  // undefined — шапка не закрепляется.
  stickyHeaderTop?: number;
  tasks: Task[];
  onCreate?: (status: TaskStatus) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  // Прокидывается в KanbanCard — управляет видимостью short-id [xxxxxxxx].
  showShortId?: boolean;
  // Если задан — на каждой карточке колонки появляется стрелка → для быстрого
  // перевода в TODO. Прокидывается KanbanBoard'ом только для backlog-колонки.
  onQuickPromote?: (task: Task) => void;
  // Триггер refetch после изменения agent-job на карточке (enqueue / cancel).
  onTaskChanged?: () => void;
  // Доп. контрол в шапке колонки (слева от «+»). Сейчас используется done-колонкой
  // для переключателя порядка сортировки.
  headerExtra?: React.ReactNode;
  // Inbox-only: показывать круглый чекбокс «выполнено» на каждой карточке.
  // Также пробрасывает lastDoneTaskId/lastTodoTaskId для afterTaskId при move'е.
  showCheckbox?: boolean;
  lastDoneTaskId?: string | null;
  lastTodoTaskId?: string | null;
  // id текущего пользователя для дочерних карточек.
  currentUserId?: string | null;
  // Drop indicator: id перетаскиваемой карточки (null = нет активного drag'а).
  activeId?: string | null;
  // E4: id открытой в drawer'е задачи (синий бордер) и только что перемещённой (синее выделение).
  openTaskId?: string | null;
  recentlyMovedId?: string | null;
  // Drop target для этой колонки (null = курсор не над этой колонкой). after —
  // вставка ПОСЛЕ over-карточки (полоска снизу), иначе перед (сверху).
  dropTarget?: { status: TaskStatus; overId: string; after?: boolean } | null;
  // taskId'ы с активной LIVE-сессией воркера — карточка рисует 🔴 точку.
  liveTaskIds?: ReadonlySet<string>;
  // Цвета колонки (пилюля заголовка + мягкая тонировка тела). Notion-стиль.
  colorClasses?: KanbanColumnColorClasses;
  // Меню колонки (троеточие): переименование / цвет / скрытие. Рендерится в шапке.
  columnMenu?: React.ReactNode;
  // Если задан — клик по названию колонки открывает inline-правку (тот же setLabel,
  // что и в меню). Без него заголовок некликабельный.
  onRename?: (label: string) => void;
  // I6: если задан — тело колонки приглушается и поверх рисуется этот оверлей-оффер
  // («Воркер» на бесплатном тарифе). Колонка становится «запертой» (клики перехвачены).
  lockOffer?: React.ReactNode;
  // Если задан — под колонкой появляется кнопка «Добавить задачу», раскрывающая
  // inline-композер (со всем функционалом быстрого создания). Создаёт задачу в этой колонке.
  onInlineCreate?: (input: InlineCreateInput) => Promise<Task>;
  readOnly?: boolean;
  // Прокидывается в inline-композер (ответственный + AI-кнопка).
  isInbox?: boolean;
  isShared?: boolean;
  aiProjectId?: string | null;
  // Уникальный ключ черновика для inline-композера этой колонки.
  composerStorageKey?: string;
  // Открыт ли inline-композер этой колонки (состояние поднято в доску — единый
  // открытый композер на все колонки; открытие в другой колонке закрывает прошлый).
  composing?: boolean;
  onComposingChange?: (open: boolean) => void;
  // === Режим мультивыделения (включается из меню колонки) ===
  // Активен ли режим выделения для ЭТОЙ колонки.
  selectionMode?: boolean;
  // Множество выбранных id. В режиме «вся доска» (инбокс) — общее на все колонки,
  // поэтому счётчик для шапки приходит отдельным пропом selectedCount.
  selectedIds?: ReadonlySet<string>;
  // Сколько задач ЭТОЙ колонки в выборе (для подписи «Выбрано N» в шапке).
  selectedCount?: number;
  onSelectToggle?: (taskId: string, mods: SelectModifiers) => void;
  // «Все» / «Очистить» — выбрать или снять все задачи ЭТОЙ колонки.
  onSelectAll?: () => void;
  onSelectNone?: () => void;
  onExitSelection?: () => void;
  // Прямой вход в режим выделения из шапки (минуя меню-троеточие).
  onEnterSelection?: () => void;
  // Старт протяжки-выделения (см. useDragSelect). Вешается на контейнер карточек:
  // в режиме выделения dnd-сенсоры к карточкам не привязаны, жест наш.
  onDragSelectStart?: (e: React.PointerEvent<HTMLElement>) => void;
};

// Дата-корзина для группировки «Готово»: Сегодня / Вчера / Ранее.
// updatedAt ≈ момент переноса в done (последнее изменение задачи).
function doneBucket(d: Date): string {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfThat = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfToday - startOfThat) / 86_400_000);
  if (diffDays <= 0) return 'Сегодня';
  if (diffDays === 1) return 'Вчера';
  return 'Ранее';
}

export function KanbanColumn({
  status,
  label,
  stickyHeaderTop,
  tasks,
  onCreate,
  onEdit,
  onDelete,
  showShortId = true,
  onQuickPromote,
  onTaskChanged,
  headerExtra,
  showCheckbox = false,
  lastDoneTaskId = null,
  lastTodoTaskId = null,
  currentUserId = null,
  activeId = null,
  openTaskId = null,
  recentlyMovedId = null,
  dropTarget = null,
  liveTaskIds,
  colorClasses,
  columnMenu,
  onRename,
  lockOffer,
  onInlineCreate,
  readOnly = false,
  isInbox = false,
  isShared = false,
  aiProjectId = null,
  composerStorageKey,
  composing = false,
  onComposingChange,
  selectionMode = false,
  selectedIds,
  selectedCount,
  onSelectToggle,
  onSelectAll,
  onSelectNone,
  onExitSelection,
  onEnterSelection,
  onDragSelectStart,
}: Props): React.ReactElement {
  // Droppable нужен чтобы можно было кинуть карточку в ПУСТУЮ колонку —
  // SortableContext один не реагирует на drop в empty list.
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${status}`,
    data: { type: 'column', status },
  });
  // Notion-style inline-создание: «+» вверху колонки → карточка с полем названия сразу в
  // потоке (без окна создания). Enter → сохранить задачу И тут же создать пустую НИЖЕ.
  const [inlineCreating, setInlineCreating] = useState(false);
  // id задач, созданных в текущей inline-сессии (в порядке создания). Рендерим их сверху
  // колонки, а карточку создания — ПОД ними (стабильный key → без ремаунта и потери фокуса).
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const lastSessionIdRef = useRef<string | null>(null);
  // Сигнал «верни фокус в поле» — растёт при «+»: карточка создания переезжает наверх (сдвиг
  // в DOM теряет фокус), поле надо сфокусировать заново после коммита.
  const [refocusSignal, setRefocusSignal] = useState(0);
  const columnRef = useRef<HTMLDivElement>(null);
  const headerSlotRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [pinnedHeader, setPinnedHeader] = useState<PinnedHeader | null>(null);

  const closeInline = (): void => {
    setInlineCreating(false);
    setSessionIds([]);
    lastSessionIdRef.current = null;
  };
  // Кнопка «+» ВСЕГДА открывает пустую карточку создания СВЕРХУ колонки (сбрасывает сессию —
  // если цепочка была ниже, новая начинается заново сверху). Цепочка вниз — только по Enter.
  const openInlineAtTop = (): void => {
    setSessionIds([]);
    lastSessionIdRef.current = null;
    setInlineCreating(true);
    setRefocusSignal((s) => s + 1);
  };
  const handleInlineCreate = async (name: string, taskIcon: string | null): Promise<Task | null> => {
    if (!onInlineCreate) return null;
    // afterTaskId = последняя созданная в сессии → новая встаёт ПОД ней (порядок создания).
    return onInlineCreate({ description: name, status, icon: taskIcon, afterTaskId: lastSessionIdRef.current });
  };
  const appendSession = (t: Task): void => {
    lastSessionIdRef.current = t.id;
    setSessionIds((prev) => [...prev, t.id]);
  };

  // I8: inline-правка названия колонки по клику. Тот же колбэк, что у меню-троеточия.
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(label);
  // Esc отменяет правку: ставим флаг, чтобы следующий blur не сохранял черновик.
  const cancelNextBlur = useRef(false);
  const startRename = (): void => {
    if (!onRename) return;
    setLabelDraft(label);
    setEditingLabel(true);
  };
  const commitRename = (): void => {
    if (cancelNextBlur.current) {
      cancelNextBlur.current = false;
      setEditingLabel(false);
      return;
    }
    const next = labelDraft.trim();
    if (next && next !== label) onRename?.(next);
    setEditingLabel(false);
  };
  const handleLabelKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelNextBlur.current = true;
      e.currentTarget.blur();
    }
  };

  // Задачи, созданные в текущей inline-сессии (в порядке создания) — рендерим их сверху
  // отдельно, чтобы карточка создания оставалась ПОД ними и не ремаунтилась. Остальные —
  // обычным сортируемым списком. Пока сессии нет (sessionIds пуст) — всё как обычно.
  const sessionActive = inlineCreating && sessionIds.length > 0;
  const sessionSet = sessionActive ? new Set(sessionIds) : null;
  const sessionTasks = sessionActive
    ? (sessionIds.map((id) => tasks.find((t) => t.id === id)).filter(Boolean) as Task[])
    : [];

  // Любая колонка показывает первые 4 карточки, дальше — «Показать ещё» порциями по 4
  // (сайт без километрового скролла). Порция считается по списку БЕЗ session-задач:
  // они всегда целиком рендерятся сверху, иначе счётчик «Показать ещё» завышался бы
  // (вплоть до фантомной кнопки при Enter-цепочке > 4 карточек). В режиме выделения —
  // всё целиком: диапазоны и «выбрать всё» должны видеть реальные карточки.
  const rest = sessionSet ? tasks.filter((t) => !sessionSet.has(t.id)) : tasks;
  const preview = useColumnPreview(rest.length);
  const listTasks = selectionMode ? rest : rest.slice(0, preview.shownCount);
  const hiddenCount = rest.length - listTasks.length;

  useLayoutEffect(() => {
    if (stickyHeaderTop == null) {
      setPinnedHeader(null);
      return;
    }
    const column = columnRef.current;
    const slot = headerSlotRef.current;
    const header = headerRef.current;
    const scroller = slot?.closest<HTMLElement>('[data-pf-kanban-scroll]') ?? null;
    if (!column || !slot || !header || !scroller) return;
    let frame = 0;
    const measure = (): void => {
      const columnRect = column.getBoundingClientRect();
      const slotRect = slot.getBoundingClientRect();
      const headerRect = header.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const height = Math.round(headerRect.height);
      const width = Math.round(slotRect.width);
      const left = Math.round(slotRect.left);
      const top = Math.round(stickyHeaderTop);
      const clipLeft = Math.max(0, Math.round(scrollerRect.left - slotRect.left));
      const clipRight = Math.max(0, Math.round(slotRect.right - scrollerRect.right));
      const hasHorizontalIntersection = width - clipLeft - clipRight > 0;
      // Открепляемся по низу ВСЕГО ряда колонок, а не своей колонки: иначе шапка короткой
      // колонки отваливается сразу, как кончились её карточки, хотя доска ещё скроллится.
      const rowBottom = columnsRowBottom(scroller, columnRect.bottom);
      const shouldPin = slotRect.top <= stickyHeaderTop && rowBottom > stickyHeaderTop + height && hasHorizontalIntersection;
      const next = shouldPin ? { left, top, width, height, clipLeft, clipRight } : null;
      setPinnedHeader((current) => samePinnedHeader(current, next) ? current : next);
    };
    const schedule = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const parents = scrollParents(slot);
    parents.forEach((parent) => parent.addEventListener('scroll', schedule, { passive: true }));
    window.addEventListener('resize', schedule, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(column);
    observer?.observe(header);
    observer?.observe(scroller);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      parents.forEach((parent) => parent.removeEventListener('scroll', schedule));
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
    };
  }, [stickyHeaderTop]);

  const pinnedHeaderStyle: CSSProperties | undefined = pinnedHeader ? {
    position: 'fixed',
    left: pinnedHeader.left,
    top: pinnedHeader.top,
    width: pinnedHeader.width,
    clipPath: `inset(0 ${pinnedHeader.clipRight}px 0 ${pinnedHeader.clipLeft}px)`,
  } : undefined;

  // Единый рендер карточки (используется и в сессии, и в основном списке).
  // dropLine — синяя полоска-индикатор дропа в зазоре над/под карточкой (absolute).
  const renderCard = (t: Task, dropLine: 'before' | 'after' | null = null): React.ReactElement => (
      <KanbanCard
      task={t}
      onEdit={onEdit}
      onDelete={onDelete}
      showShortId={showShortId}
      onQuickPromote={onQuickPromote}
      onTaskChanged={onTaskChanged}
      showCheckbox={showCheckbox}
      lastDoneTaskId={lastDoneTaskId}
      lastTodoTaskId={lastTodoTaskId}
      currentUserId={currentUserId}
      liveRunning={liveTaskIds?.has(t.id) ?? false}
      open={t.id === openTaskId}
      recentlyMoved={t.id === recentlyMovedId}
      selectionMode={selectionMode}
      selected={selectedIds?.has(t.id) ?? false}
      onSelectToggle={onSelectToggle}
        dropLine={dropLine}
        readOnly={readOnly}
    />
  );

  // Карточка inline-создания (стабильный key — без ремаунта при добавлении сессионных карточек).
  const inlineCard =
    inlineCreating && onInlineCreate ? (
      <InlineNewCard
        key="inline-new"
        refocusSignal={refocusSignal}
        onOpenFull={onEdit}
        onCreate={handleInlineCreate}
        onCreated={appendSession}
        onClose={closeInline}
      />
    ) : null;

  return (
    <div
      ref={columnRef}
      className={cn(
        // group/column — именованный, чтобы не конфликтовать с голым `group` карточек:
        // на hover колонки проявляем «тихие» иконки шапки (Notion-style).
        // Высота — по контенту (Notion single-scroll): колонка растёт вниз, свой скролл не нужен —
        // скроллится вся страница целиком.
        // snap-center + snap-always (моб): при свайпе колонка магнитно встаёт по ЦЕНТРУ
        // экрана, ровно ОДИН магнит на колонку (snap-always запрещает проскок мимо — каждая
        // колонка обязательная остановка). 92vw оставляет узкие «пипки» соседей по краям —
        // видно, что доска листается. На sm+ снап выключен (sm:snap-none) — свободный скролл.
        // Замеры Notion: колонка 276px, скругление 10px. Шапка и тело — ОДИН блок с общим
        // фоном (у Notion это 10px 10px 0 0 + 0 0 10px 10px), поэтому фон и радиус живут здесь.
        'group/column flex w-[92vw] max-w-[24rem] shrink-0 snap-center snap-always flex-col rounded-[10px] sm:w-[276px] sm:max-w-none',
        colorClasses?.body ?? DEFAULT_COLUMN_TINT,
        // Объявляет --pf-card-ring: карточки внутри наследуют цвет своего кольца.
        colorClasses?.ring,
      )}
    >
      <div ref={headerSlotRef} className="shrink-0" style={pinnedHeader ? { height: pinnedHeader.height } : undefined}>
        <div
          ref={headerRef}
          style={pinnedHeaderStyle}
          className={cn(
          // Замеры Notion: шапка колонки ровно 40px. 6+6 паддинга + самый высокий элемент
          // ряда (кнопка «+», на десктопе 28px) = 40. Пилюля 20px встаёт по центру, под ней
          // остаётся 10px, ещё 8px даёт p-2 тела — до первой карточки 18px, как в эталоне.
          // min-h-10 держит те же 40px и когда правой группы нет вовсе (read-only доска):
          // шапки всех колонок обязаны быть одной высоты, иначе карточки стартуют вразнобой.
          'flex min-h-10 shrink-0 items-center justify-between gap-2 px-3 py-1.5',
          // Режим выделения: подсвечиваем шапку акцентом, чтобы было видно активную колонку.
          selectionMode && 'rounded-t-[10px] bg-primary/10',
          // Своя заливка нужна шапке ТОЛЬКО пока она реально откреплена (position: fixed):
          // иначе сквозь неё просвечивали бы уезжающие карточки. В обычном состоянии шапка
          // прозрачная — сквозь неё видна тонировка колонки, шапка и тело читаются как один
          // блок (Notion). Фон сплошной, без backdrop-blur: blur при вертикальном скролле
          // доски дико тормозит iOS Safari. Здесь только НЕПРОЗРАЧНАЯ база: тонировку колонки
          // и подсветку выделения возвращают слои ниже — одним классом их не сложить, twMerge
          // оставил бы от двух bg-* только последний (из-за этого у закреплённой шапки и
          // пропадала подсветка выделения).
          pinnedHeader != null && 'z-30 rounded-t-[10px] bg-background',
          )}
        >
        {/* Слои открепленной шапки. Она ушла из потока колонки, поэтому тонировку колонки
            (а в режиме выделения — и акцент) докрашивает сама: без этого в тёмной теме под
            закреплённой шапкой видна полоса-стык (фон 9% против колонки ~13%). -z-10 внутри
            её же stacking-контекста (fixed + z-30) кладёт слои ПОВЕРХ bg-background, но ПОД
            содержимое шапки. */}
        {pinnedHeader != null && (
          <>
            <span
              aria-hidden
              className={cn(
                'pointer-events-none absolute inset-0 -z-10 rounded-t-[10px]',
                colorClasses?.body ?? DEFAULT_COLUMN_TINT,
              )}
            />
            {selectionMode && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 -z-10 rounded-t-[10px] bg-primary/10"
              />
            )}
          </>
        )}
        {selectionMode ? (
          <>
            <span className="min-w-0 truncate text-xs font-medium">
              Выбрано {selectedCount ?? selectedIds?.size ?? 0}
            </span>
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                variant="ghost"
                size="sm"
                // sm:h-6 обязателен: базовый h-6 не перебивает sm:h-9 из варианта size="sm"
                // (медиазапрос идёт после базовых утилит) — без него шапка в режиме выделения
                // была на 8px выше обычной. max-sm:h-11 держит тач-цель 44px на мобиле:
                // глобальное правило globals.css сюда не достаёт (в классе Button есть
                // подстрока `size-` из [&_svg…]:size-[1.05em]).
                className="h-6 px-2 text-xs max-sm:h-11 sm:h-6"
                onClick={onSelectAll}
              >
                Все
              </Button>
              <Button
                variant="ghost"
                size="sm"
                // Размеры — как у «Все» выше (см. комментарий там).
                className="h-6 px-2 text-xs max-sm:h-11 sm:h-6"
                onClick={onSelectNone}
              >
                Очистить
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-9 sm:size-6"
                onClick={onExitSelection}
                aria-label="Выйти из режима выделения"
                title="Выйти (Esc)"
              >
                <X className="size-4" />
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex min-w-0 items-center gap-1.5">
              {label.length > 0 && (
                <>
                  {/* Замеры Notion: залитая пилюля 20px высотой, radius 10px, текст 14px,
                      точка 8×8 внутри. Цвет колонки живёт ЗДЕСЬ (11–20% альфы), а тело
                      колонки почти прозрачное — так доска не выглядит залитой.
                      min-h-5, а не h-5: на мобиле globals.css форсит 16px шрифта в поле
                      переименования, и пилюля обязана подрасти под него. leading-5 вместо
                      leading-none: 14px-строка в 14px-боксе резала выносные кириллицы
                      (у, р, д) — у названия стоит truncate, т.е. overflow:hidden. */}
                  <span
                    className={cn(
                      'flex min-h-5 min-w-0 max-w-full items-center gap-1.5 rounded-[10px] px-2 text-sm leading-5',
                      colorClasses?.pill ??
                        'bg-[rgba(55,53,47,0.08)] text-[rgb(85,83,78)] dark:bg-[rgba(255,255,255,0.09)] dark:text-[rgb(196,194,189)]',
                    )}
                  >
                    <span
                      className={cn('size-2 shrink-0 rounded-full', colorClasses?.dot ?? 'bg-muted-foreground/40')}
                      aria-hidden
                    />
                    {editingLabel ? (
                      <input
                        autoFocus
                        value={labelDraft}
                        onChange={(e) => setLabelDraft(e.target.value)}
                        onFocus={(e) => e.target.select()}
                        onKeyDown={handleLabelKeyDown}
                        onBlur={commitRename}
                        maxLength={40}
                        aria-label="Название колонки"
                        // Высоту задаёт line-height, а НЕ h-*: globals.css форсит на всех
                        // input под 640px font-size:16px !important (анти-зум iOS), и в
                        // фиксированном боксе 16px-шрифт обрезал бы выносные кириллицы
                        // (у, р, д, б). 20px хватает под 14px десктопа, 24px — под
                        // форсированные 16px; пилюля-родитель на min-h-5 подрастает следом.
                        className="w-full min-w-0 max-w-[10rem] rounded-[4px] bg-background/80 px-1 py-0 text-sm font-medium leading-5 text-foreground outline-none focus:ring-1 focus:ring-foreground/25 max-sm:leading-6"
                      />
                    ) : (
                      <span
                        role={onRename ? 'button' : undefined}
                        tabIndex={onRename ? 0 : undefined}
                        onClick={onRename ? startRename : undefined}
                        onKeyDown={
                          onRename
                            ? (e) => {
                                if (e.key === 'Enter' || e.key === 'F2') startRename();
                              }
                            : undefined
                        }
                        title={onRename ? 'Переименовать колонку' : undefined}
                        className={cn(
                          'min-w-0 truncate font-medium',
                          // Внутри залитой пилюли hover-плашка выглядела бы заплаткой —
                          // «кликабельность» показываем лёгким прозрачным откликом.
                          onRename &&
                            'cursor-text rounded-[4px] outline-none hover:opacity-75 focus-visible:ring-1 focus-visible:ring-ring',
                        )}
                      >
                        {label}
                      </span>
                    )}
                  </span>
                  {/* Подзаголовок (напр. «Claude Opus») — в ТОЙ ЖЕ строке, что и пилюля.
                      Под пилюлей он делал шапку «Воркера» выше соседних, и первая карточка
                      этой колонки начиналась ниже; у Notion все шапки строго одной высоты.
                      flex-1 (= flex:1 1 0%) — то, что даёт НАЗВАНИЮ приоритет над
                      подзаголовком: базовая ширина подзаголовка 0, поэтому он живёт только
                      на СВОБОДНОМ месте строки и в дефиците ширины не отнимает у пилюли ни
                      пикселя (вес сжатия = shrink × базовая ширина = 0). Пока место есть —
                      дорастает до своего текста; места меньше — сам ужимается по truncate;
                      места нет — схлопывается в ноль и исчезает, и только ПОСЛЕ этого
                      начинает резаться название колонки. Раньше оба сжимались вместе, и
                      «Воркер» превращался в многоточие ради «Claude Opus».
                      title — чтобы ужатый подзаголовок можно было дочитать наведением.
                      leading-4, а не leading-tight: 10px-строке нужен запас, иначе truncate
                      (overflow:hidden) срезает хвост «p» в «Opus». */}
                  {STATUS_SUBTITLE[status] && !editingLabel && (
                    <span
                      title={STATUS_SUBTITLE[status]}
                      // На мобиле прячем совсем (там колонки уже, а подпись — второстепенная):
                      // название «Воркер» гарантированно не режется. На десктопе показываем «Opus».
                      className="hidden min-w-0 flex-1 truncate text-[10px] leading-4 text-muted-foreground/60 sm:inline"
                    >
                      {STATUS_SUBTITLE[status]}
                    </span>
                  )}
                </>
              )}
              <span className="shrink-0 px-0.5 text-xs tabular-nums text-muted-foreground/70">
                {tasks.length}
              </span>
            </div>
            <div className="flex items-center gap-0.5">
              {/* «Тихие» действия: видны на hover/focus колонки и при открытом меню;
                  на тач-устройствах (<sm) — всегда, hover'а там нет. */}
              <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/column:opacity-100 group-hover/column:opacity-100 has-[[data-state=open]]:opacity-100 max-sm:opacity-100">
                {headerExtra}
                {onEnterSelection && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 sm:size-6"
                    onClick={onEnterSelection}
                    aria-label="Выделить задачи"
                    title="Выделить задачи"
                  >
                    <ListChecks className="size-4" />
                  </Button>
                )}
                {columnMenu}
              </div>
              {!readOnly && onCreate && (
                <Button
                  variant="ghost"
                  size="icon"
                  // 28px на десктопе — самый высокий элемент шапки, он и задаёт эталонные
                  // 40px (6+28+6). Мобильный размер приходит из варианта icon
                  // (max-sm:size-11 = 44px, тач-цель): медиазапрос идёт после базовых утилит,
                  // поэтому базовый size-8 его не перебивает.
                  className="size-8 sm:size-7"
                // Не крадём фокус у открытой карточки создания — иначе её blur-commit закроет
                // сессию раньше, чем «+» успеет открыть новую сверху.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => (onInlineCreate ? openInlineAtTop() : onCreate(status))}
                  aria-label="Добавить задачу"
                >
                  <Plus className="size-5 sm:size-4" />
                </Button>
              )}
            </div>
          </>
        )}
        </div>
      </div>

      <div className="relative flex flex-col">
      <div
        ref={setNodeRef}
        // Протяжка-выделение стартует только в режиме выделения (хук сам пассивен вне его,
        // но лишний слушатель на обычной доске не вешаем).
        onPointerDown={selectionMode ? onDragSelectStart : undefined}
        className={cn(
          // min-h — чтобы у пустой/короткой колонки была зона для drop'а (высота по контенту).
          // p-2 + gap-2 = замеры Notion: паддинг 8px (276 − 16 = 260 ширина карточки),
          // вертикальный зазор между карточками 8px.
          'flex min-h-[4rem] flex-col gap-2 p-2 transition-colors',
          // Подсветка цели дропа. Серый bg-muted/60 читался заплаткой, а 2% чёрного поверх
          // уже тонированной колонки не читались вовсе — состояние было мёртвым. Берём цвет
          // акцента (тот же синий, что у полоски-индикатора): от тонировки колонки он
          // отличается и светлотой, и тоном, при этом остаётся мягким. rounded-b — у колонки
          // без композера тело доходит до низа, квадратные углы вылезали бы за её скругление.
          isOver && !lockOffer && 'rounded-b-[10px] bg-primary/[0.08] dark:bg-primary/[0.14]',
        )}
      >
        {/* I6: на free-тарифе колонка «Воркер» — не список задач, а оффер (в обычном потоке,
            колонка выглядит как нормальная). Иначе — обычный список карточек. */}
        {lockOffer ? (
          lockOffer
        ) : (
        <>
        {/* Notion-style inline-создание: сверху — уже созданные в этой сессии карточки (в
            порядке создания), ПОД ними — карточка создания (стабильный key, без ремаунта).
            Enter сохраняет и оставляет пустое поле ниже. Остальные задачи — обычным списком. */}
        {sessionTasks.map((t) => (
          <Fragment key={t.id}>{renderCard(t)}</Fragment>
        ))}
        {inlineCard}
        <SortableContext items={listTasks.map((t) => t.id)} strategy={noReflowStrategy}>
          {listTasks.map((t, idx) => {
            // Синяя полоска дропа — ПОВЕРХ карточки в зазоре (absolute, не двигает
            // соседей). Сторона (before/after) — по позиции курсора (dropTarget.after).
            const isLast = idx === listTasks.length - 1;
            const activeIdx = activeId ? listTasks.findIndex((x) => x.id === activeId) : -1;
            let dropLine: 'before' | 'after' | null = null;
            if (dropTarget && dropTarget.overId === t.id && t.id !== activeId) {
              const side = dropTarget.after ? 'after' : 'before';
              // #5: не рисуем полоску на текущем месте перетаскиваемой карточки
              // (её сосед сверху→after / снизу→before = тот же слот, дроп = no-op).
              const isNoop =
                activeIdx >= 0 &&
                ((side === 'before' && idx === activeIdx + 1) ||
                  (side === 'after' && idx === activeIdx - 1));
              if (!isNoop) dropLine = side;
            } else if (
              dropTarget &&
              dropTarget.overId === `column-${status}` &&
              isLast &&
              t.id !== activeId &&
              activeIdx !== listTasks.length - 1 // active уже последняя → дроп в конец no-op
            ) {
              dropLine = 'after';
            }
            return (
              <Fragment key={t.id}>
                {/* «Готово» группируем по датам завершения: Сегодня / Вчера / Ранее. */}
                {status === 'done' &&
                  (idx === 0 ||
                    doneBucket((listTasks[idx - 1] ?? t).updatedAt) !== doneBucket(t.updatedAt)) && (
                    <p className="px-1 pb-0.5 pt-1.5 text-[11px] font-medium text-muted-foreground/70 first:pt-0">
                      {doneBucket(t.updatedAt)}
                    </p>
                  )}
                {renderCard(t, dropLine)}
              </Fragment>
            );
          })}
        </SortableContext>
        {/* Пустая колонка (нет карточек) — тонкая статичная полоска как цель дропа. */}
        {listTasks.length === 0 && dropTarget && dropTarget.overId === `column-${status}` && (
          <div className="pointer-events-none mx-1 flex items-center gap-1">
            <span className="size-1.5 shrink-0 rounded-full bg-primary" />
            <span className="h-0.5 flex-1 rounded-full bg-primary shadow-[0_0_6px_rgba(59,130,246,0.5)]" />
            <span className="size-1.5 shrink-0 rounded-full bg-primary" />
          </div>
        )}
        {!selectionMode && <ColumnMoreButton preview={preview} />}
        {hiddenCount > 0 && (
          <span className="sr-only">{`Скрыто карточек: ${hiddenCount}`}</span>
        )}
        </>
        )}
      </div>
      </div>

      {onInlineCreate && !lockOffer && (
        <div className="shrink-0 p-2 pt-0">
          {composing ? (
            <TaskComposer
              variant="inline"
              forcedStatus={status}
              autoFocus
              onClose={() => onComposingChange?.(false)}
              onCreate={onInlineCreate}
              isInbox={isInbox}
              isShared={isShared}
              aiProjectId={aiProjectId}
              storageKey={composerStorageKey}
            />
          ) : (
            <button
              type="button"
              onClick={() => onComposingChange?.(true)}
              className={cn(
                // Замеры Notion §5b: внизу колонки не кнопка, а «ПУСТАЯ КАРТОЧКА» — та же
                // геометрия, что у карточек (260×40 = ширина колонки минус 8px паддинга
                // тела с каждой стороны, radius 10px, внутренние отступы 0 10px), но без
                // заливки: держит форму одно кольцо в 1px.
                // Высота ровно 40px (h-10) только на десктопе: на мобиле globals.css поднимает
                // кнопкам без явного size-* min-height до 44px (тач-цель Apple HIG), и
                // min-height бьёт height — так и задумано, тач-цель не урезаем.
                'flex h-10 w-full items-center gap-1.5 rounded-[10px] bg-transparent px-2.5 text-[15px] font-normal transition-colors',
                // Кольцо — ТО ЖЕ, что у карточек этой колонки: читаем --pf-card-ring, которую
                // объявляет корень колонки (colorClasses.ring). Второго источника цвета нет.
                // Фолбэки (нейтральные) повторяют KanbanCard — на случай рендера вне доски.
                'shadow-[0_0_0_1px_var(--pf-card-ring,rgba(42,28,0,0.07))] dark:shadow-[0_0_0_1px_var(--pf-card-ring,rgba(255,255,255,0.09))]',
                // Текст — акцент колонки (у Notion он в цвет статуса, а не серый).
                colorClasses?.action ?? 'text-[rgb(95,94,89)] dark:text-[rgb(155,153,148)]',
                // Ховер — прозрачная подложка, а не bg-accent: сплошной серый поверх
                // тонированной колонки читался бы заплаткой (та же логика, что у подсветки
                // цели дропа выше).
                'hover:bg-[rgba(55,53,47,0.045)] dark:hover:bg-[rgba(255,255,255,0.05)]',
              )}
            >
              <Plus className="size-4" />
              Создать задачу
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Notion-style карточка создания: поле названия сразу в потоке колонки. Enter — сохранить и
// открыть следующую (быстрый ввод); клик вне карточки — сохранить и закрыть; Esc — отмена;
// «открыть справа» — сохранить и открыть задачу в окне справа.
function InlineNewCard({
  onCreate,
  onCreated,
  onClose,
  onOpenFull,
  refocusSignal = 0,
}: {
  onCreate: (name: string, icon: string | null) => Promise<Task | null>;
  // Вызывается после успешного Enter-создания (родитель добавляет задачу в сессию и рендерит
  // её ВЫШЕ карточки создания). Не вызывается при blur/«открыть справа» (там сессия закрывается).
  onCreated?: (task: Task) => void;
  onClose: () => void;
  onOpenFull: (task: Task) => void;
  // Растёт по «+» — вернуть фокус в поле после переезда карточки наверх.
  refocusSignal?: number;
}): React.ReactElement {
  const [value, setValue] = useState('');
  const [icon, setIcon] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Идёт ли взаимодействие с поповером иконки — пока да, блёр textarea НЕ коммитит/не
  // закрывает карточку (иначе клик по эмодзи в пикере убивал бы карточку до выбора).
  // Держим флаг ещё ~200мс после закрытия, чтобы отложенный blur-commit его увидел.
  const pickingRef = useRef(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const closingRef = useRef(false);
  // Запрос на возврат фокуса ПОСЛЕ рендера. Enter создаёт задачу выше → карточка создания
  // сдвигается в DOM (теряет фокус); rAF не успевает. Фокусим в effect после коммита DOM.
  const refocusRef = useRef(false);
  // Окно ~после Enter: любой блёр в это время (сдвиг карточки в DOM, разное поведение фокуса
  // на разных ОС/браузерах) НЕ закрывает карточку. Иначе на части машин Enter сохранял задачу,
  // но карточку создания тут же закрывал blur-commit — новая пустая не появлялась.
  const justEnteredRef = useRef(false);
  const justEnteredTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    ref.current?.focus();
  }, []);
  // useLayoutEffect — синхронно после коммита DOM (до макротаска blur-commit), чтобы фокус
  // гарантированно вернулся в поле раньше, чем сработает отложенная проверка закрытия.
  useLayoutEffect(() => {
    if (refocusRef.current) {
      refocusRef.current = false;
      const el = ref.current;
      if (el) {
        el.style.height = 'auto';
        el.focus();
      }
    }
  });
  // По «+» карточка переезжает наверх (сдвиг в DOM теряет фокус) — возвращаем его. Пропускаем
  // самый первый рендер (mount-эффект уже сфокусировал).
  const mountedRef = useRef(false);
  useLayoutEffect(() => {
    if (mountedRef.current) ref.current?.focus();
    else mountedRef.current = true;
  }, [refocusSignal]);

  const grow = (el: HTMLTextAreaElement): void => {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  // defaultName — имя, если поле пустое (для Enter по пустому полю: «Новая задача»).
  // blur/«открыть справа» его НЕ передают: по пустому полю там просто закрываем без создания.
  const create = async (defaultName?: string): Promise<Task | null> => {
    const name = value.trim() || defaultName?.trim() || '';
    if (!name || busy) return null;
    setBusy(true);
    try {
      return await onCreate(name, icon);
    } finally {
      setBusy(false);
    }
  };

  // Enter → создать задачу (она встаёт ВЫШЕ), поле очищается и остаётся для следующей.
  // Фокус возвращаем в effect после коммита (карточка сдвигается в DOM и теряет фокус).
  const markJustEntered = (): void => {
    justEnteredRef.current = true;
    if (justEnteredTimer.current) window.clearTimeout(justEnteredTimer.current);
    justEnteredTimer.current = window.setTimeout(() => {
      justEnteredRef.current = false;
    }, 400);
  };
  const onEnter = async (): Promise<void> => {
    // Ставим флаг СРАЗУ (до await) — блёр от сохранения/сдвига не должен закрыть карточку.
    markJustEntered();
    // Enter по ПУСТОМУ полю → задача «Новая задача» (и снова пустая карточка ниже).
    const t = await create('Новая задача');
    if (t) {
      onCreated?.(t);
      setValue('');
      setIcon(null);
      refocusRef.current = true;
      markJustEntered();
    }
  };
  // Клик вне карточки → создать (если есть текст) и закрыть. Откладываем на тик и
  // пропускаем, если фокус ушёл в поповер иконки (взаимодействие с пикером, не выход).
  const onBlurCommit = (): void => {
    window.setTimeout(() => {
      if (closingRef.current || pickingRef.current) return;
      // Только что был Enter — блёр от сохранения/сдвига карточки, НЕ выход. Не закрываем.
      if (justEnteredRef.current) return;
      const active = document.activeElement;
      // Фокус вернулся в само поле (сдвиг карточки в DOM после Enter) — это НЕ выход, не закрываем.
      if (active === ref.current) return;
      if (active && active.closest('[data-radix-popper-content-wrapper], .bg-popover')) return;
      void create().then(() => onClose());
    }, 0);
  };
  // «Открыть справа» → создать и открыть в окне справа.
  const openFull = async (): Promise<void> => {
    closingRef.current = true;
    const t = await create();
    onClose();
    if (t) onOpenFull(t);
  };

  // Радиус 10px — как у обычной карточки (замеры Notion), чтобы карточка создания
  // не выбивалась из ряда.
  return (
    <div className="group/new rounded-[10px] border bg-card p-2 ring-1 ring-primary/20">
      {/* items-start: иконка стоит рядом с ПЕРВОЙ строкой (при многострочном названии остаётся
          сверху); при однострочном — визуально по центру. gap-1.5 — компактно. */}
      <div className="flex items-start gap-1.5">
        {/* Иконка задачи размером с текст (не крупный квадрат) — пикер тот же. Пока пикер
            открыт — не закрываем карточку; после выбора возвращаем фокус в поле. */}
        <IconPicker
          value={icon}
          onChange={(v) => {
            setIcon(v);
            requestAnimationFrame(() => ref.current?.focus());
          }}
          onOpenChange={(open) => {
            if (open) {
              pickingRef.current = true;
            } else {
              // Держим флаг чуть дольше, чтобы уже запланированный blur-commit его увидел,
              // затем возвращаем фокус в поле — карточка живёт.
              window.setTimeout(() => {
                pickingRef.current = false;
              }, 200);
              requestAnimationFrame(() => ref.current?.focus());
            }
          }}
          trigger={
            <button
              type="button"
              // Не крадём фокус у поля (иначе blur-commit закроет карточку до открытия пикера).
              onMouseDown={(e) => e.preventDefault()}
              aria-label={icon ? 'Сменить иконку' : 'Добавить иконку'}
              title="Иконка задачи"
              className="mt-px grid size-5 shrink-0 cursor-pointer place-items-center overflow-hidden rounded text-muted-foreground/80 transition-colors hover:text-foreground"
            >
              {icon ? (
                <ProjectIconView icon={icon} pixelSize={18} className="text-[1.05rem]" />
              ) : (
                <FileText className="size-[1.05rem]" />
              )}
            </button>
          }
        />
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            grow(e.currentTarget);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void onEnter();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              closingRef.current = true;
              onClose();
            }
          }}
          onBlur={onBlurCommit}
          rows={1}
          placeholder="Название задачи…"
          disabled={busy}
          className="min-h-[1.25rem] w-full resize-none overflow-hidden bg-transparent text-sm leading-snug outline-none placeholder:text-muted-foreground/70"
        />
        <button
          type="button"
          // preventDefault на mousedown — не терять фокус textarea до клика (иначе onBlur обгонит).
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void openFull()}
          title="Открыть справа"
          aria-label="Открыть справа"
          className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/new:opacity-100"
        >
          <PanelRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
