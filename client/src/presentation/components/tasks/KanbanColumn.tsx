import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, type SortingStrategy } from '@dnd-kit/sortable';

// Notion-style drag: карточки НЕ раздвигаются/не дёргаются при перетаскивании — место
// дропа показывает только синяя полоска (DropIndicatorLine). Стратегия без сдвигов —
// возвращает null для всех соседей (dnd-kit не применяет transform реордера).
const noReflowStrategy: SortingStrategy = () => null;
import { ListChecks, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { RalphMode, Task, TaskPriority, TaskStatus } from '@/domain/task/Task';
import type { MoveTaskInput } from '@/application/task/TaskRepository';
import { cn } from '@/lib/utils';
import { KanbanCard } from './KanbanCard';
import { COLUMN_SCROLL_CLASS } from './ColumnPreview';
import { TaskComposer } from './TaskComposer';
import { InlineNewCard, type InlineTaskSettings } from './InlineNewCard';
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
const DEFAULT_COLUMN_TINT = 'bg-panel';

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
  creationDefaults?: Partial<InlineTaskSettings>;
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
  // Прокидывается в KanbanCard → InboxCheckbox: оптимистичный useTasks().move доски,
  // чтобы «Принять работу» на карточке переезжала между колонками мгновенно.
  onMove?: (taskId: string, input: MoveTaskInput) => Promise<void>;
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
  // Бейдж состояния колонки (например включённый фильтр по типу). Рендерится в шапке
  // между названием и счётчиком. Содержимое и обработчики задаёт доска.
  headerBadge?: React.ReactNode;
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
  // Императивный сигнал «открой inline-создание СВЕРХУ этой колонки» — так синяя
  // «Создать» (и пустое состояние доски) ведут себя как клик по «+» в колонке, без
  // модального окна. Меняющееся положительное число = новый запрос (см. openInlineAtTop).
  openInlineSeq?: number;
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
  creationDefaults,
  onEdit,
  onDelete,
  showShortId = true,
  onQuickPromote,
  onTaskChanged,
  headerExtra,
  showCheckbox = false,
  lastDoneTaskId = null,
  lastTodoTaskId = null,
  onMove,
  currentUserId = null,
  activeId = null,
  openTaskId = null,
  recentlyMovedId = null,
  dropTarget = null,
  liveTaskIds,
  colorClasses,
  columnMenu,
  headerBadge,
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
  openInlineSeq = 0,
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
  // Внешний императивный запрос (синяя «Создать» / пустое состояние доски) открывает
  // inline-создание сверху этой колонки — как клик по «+». Реагируем на смену
  // положительного seq (0 = нет запроса) и подскролливаем колонку в вид.
  useEffect(() => {
    if (!openInlineSeq || openInlineSeq <= 0 || !onInlineCreate) return;
    openInlineAtTop();
    columnRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
    // openInlineAtTop пересоздаётся каждый рендер, но эффект должен срабатывать только на
    // смену seq — иначе он гонялся бы на любом ререндере колонки.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openInlineSeq]);
  const handleInlineCreate = async (name: string, taskIcon: string | null, settings: InlineTaskSettings): Promise<Task | null> => {
    if (!onInlineCreate) return null;
    // afterTaskId = последняя созданная в сессии → новая встаёт ПОД ней (порядок создания).
    return onInlineCreate({ ...settings, description: name, status, icon: taskIcon, afterTaskId: lastSessionIdRef.current });
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

  // Список без session-задач: только что созданные в этой сессии карточки рендерятся
  // отдельным блоком сверху, чтобы не прыгать по колонке при пересортировке.
  const rest = sessionSet ? tasks.filter((t) => !sessionSet.has(t.id)) : tasks;
  const listTasks = rest;

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
      onMove={onMove}
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
        projectId={aiProjectId ?? undefined}
        defaults={creationDefaults}
        onOpenFull={onEdit}
        onCreate={handleInlineCreate}
        onCreated={appendSession}
        onClose={closeInline}
      />
    ) : null;

  return (
    <div
      ref={columnRef}
      data-pf-kanban-column
      // По статусу колонку находит навигация по колонкам на телефоне (BoardColumnTabs).
      data-pf-column-status={status}
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
        // Дизайн C4: колонка — серый лист (bg-panel) с радиусом 10px; цветная колонка
        // (настройка пользователя) — та же форма с лёгкой тонировкой своего цвета.
        'group/column flex w-[92vw] max-w-[24rem] shrink-0 snap-center snap-always flex-col rounded-xl sm:w-[276px] sm:max-w-none',
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
          // Дизайн C4: шапка плотнее — 36px, метка-тег слева, счётчик серым числом.
          'flex min-h-9 shrink-0 items-center justify-between gap-2 px-2 py-1',
          // Режим выделения: подсвечиваем шапку акцентом, чтобы было видно активную колонку.
          selectionMode && 'rounded-bs-xl bg-primary-soft',
          // Своя заливка нужна шапке ТОЛЬКО пока она реально откреплена (position: fixed):
          // иначе сквозь неё просвечивали бы уезжающие карточки. В обычном состоянии шапка
          // прозрачная — сквозь неё видна тонировка колонки, шапка и тело читаются как один
          // блок (Notion). Фон сплошной, без backdrop-blur: blur при вертикальном скролле
          // доски дико тормозит iOS Safari. Здесь только НЕПРОЗРАЧНАЯ база: тонировку колонки
          // и подсветку выделения возвращают слои ниже — одним классом их не сложить, twMerge
          // оставил бы от двух bg-* только последний (из-за этого у закреплённой шапки и
          // пропадала подсветка выделения).
          pinnedHeader != null && 'z-30 rounded-bs-xl bg-background',
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
                'pointer-events-none absolute inset-0 -z-10 rounded-bs-xl',
                colorClasses?.body ?? DEFAULT_COLUMN_TINT,
              )}
            />
            {selectionMode && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 -z-10 rounded-bs-xl bg-primary-soft"
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
                  {/* Дизайн C4: метка-тег 22px с радиусом 5px, полужирное название. Цвет —
                      из настроек колонки (пастель в светлой теме, тинт в тёмной); точка
                      цвета — только в тёмной теме, где подложка тише (как метки «Входящих»). */}
                  <span
                    className={cn(
                      'flex min-h-[22px] min-w-0 max-w-full items-center gap-1.5 rounded-[5px] px-[7px] text-ui leading-5',
                      colorClasses?.pill ?? 'bg-tone-bg text-tone-fg pf-tone-gray',
                    )}
                  >
                    <span
                      className={cn(
                        'hidden size-2 shrink-0 rounded-[3px] dark:block',
                        colorClasses?.dot ?? 'bg-muted-foreground/50',
                      )}
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
                          'min-w-0 truncate font-semibold',
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
              {headerBadge}
              <span className="shrink-0 text-ui tabular-nums text-muted-foreground">{tasks.length}</span>
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
          // Дизайн C4: отступ 6px и зазор между карточками 5px — плотнее Notion.
          'flex min-h-[4rem] flex-col gap-[5px] p-1.5 pbs-0.5 transition-colors',
          COLUMN_SCROLL_CLASS,
          // Телефон: колонка почти во всю ширину экрана, и почти любой вертикальный свайп
          // начинается внутри её списка. overscroll-contain запирал такой свайп в колонке —
          // долистав её до верха, вернуться к шапке проекта можно было только «поймав»
          // шапку колонки. Здесь прокрутка у края передаётся странице.
          'max-sm:overscroll-y-auto',
          // Подсветка цели дропа. Серый bg-muted/60 читался заплаткой, а 2% чёрного поверх
          // уже тонированной колонки не читались вовсе — состояние было мёртвым. Берём цвет
          // акцента (тот же синий, что у полоски-индикатора): от тонировки колонки он
          // отличается и светлотой, и тоном, при этом остаётся мягким. rounded-b — у колонки
          // без композера тело доходит до низа, квадратные углы вылезали бы за её скругление.
          isOver && !lockOffer && 'rounded-be-xl bg-drop',
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
                    <p className="px-1 pbe-0.5 pbs-1.5 text-2xs font-medium text-muted-foreground/70 first:pbs-0">
                      {doneBucket(t.updatedAt)}
                    </p>
                  )}
                {renderCard(t, dropLine)}
              </Fragment>
            );
          })}
        </SortableContext>
        {tasks.length === 0 && !inlineCard && !composing && (
          <div className="pointer-events-none mx-0.5 rounded-lg border border-dashed border-drop-line px-3 py-5 text-center">
            <p className="text-xs font-medium text-muted-foreground">Здесь пока нет задач</p>
            {!readOnly && <p className="mbs-1 text-2xs leading-relaxed text-muted-foreground/80">Перенесите сюда задачу из другой колонки</p>}
          </div>
        )}
        {/* Пустая колонка (нет карточек) — тонкая статичная полоска как цель дропа. */}
        {listTasks.length === 0 && dropTarget && dropTarget.overId === `column-${status}` && (
          <div className="pointer-events-none mx-1 flex items-center gap-1">
            <span className="size-1.5 shrink-0 rounded-full bg-primary" />
            <span className="h-0.5 flex-1 rounded-full bg-primary shadow-[0_0_6px_oklch(62.31%_0.188_259.81/0.5)]" />
            <span className="size-1.5 shrink-0 rounded-full bg-primary" />
          </div>
        )}
        </>
        )}
      </div>
      </div>

      {onInlineCreate && !lockOffer && (
        <div className="shrink-0 p-1.5 pbs-0">
          {composing ? (
            <TaskComposer
              variant="inline"
              defaults={creationDefaults}
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
                'flex h-9 w-full items-center gap-1.5 rounded-lg bg-transparent px-2.5 text-ui font-normal transition-colors',
                // Кольцо — ТО ЖЕ, что у карточек этой колонки: читаем --pf-card-ring, которую
                // объявляет корень колонки (colorClasses.ring). Второго источника цвета нет.
                // Фолбэки (нейтральные) повторяют KanbanCard — на случай рендера вне доски.
                'shadow-[0_0_0_1px_var(--pf-card-ring,oklch(23.78%_0.049_82.45/0.07))] dark:shadow-[0_0_0_1px_var(--pf-card-ring,oklch(100%_0_none/0.09))]',
                // Текст — акцент колонки (у Notion он в цвет статуса, а не серый).
                colorClasses?.action ?? 'text-muted-foreground',
                // Ховер — прозрачная подложка, а не bg-accent: сплошной серый поверх
                // тонированной колонки читался бы заплаткой (та же логика, что у подсветки
                // цели дропа выше).
                'hover:bg-hover',
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
