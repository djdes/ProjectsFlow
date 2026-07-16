import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { CalendarOff, ChevronLeft, ChevronRight, FileText, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { Task } from '@/domain/task/Task';
import { useContainer } from '@/infrastructure/di/container';
import { useTasks } from '@/presentation/hooks/useTasks';
import { ProjectIconView } from '@/presentation/components/project/projectIconView';
import { type TaskDrawerState } from '../TaskDrawer';
import { addDays, startOfDay, ymd } from '../assignedGrouping';
import type { ViewCreateRequest } from './ProjectBoardViews';
import {
  NewTaskRow,
  STATUS_DOT,
  ViewTaskDrawer,
  matchesFilters,
  taskMenuEntries,
  taskTitle,
  type ViewFilters,
} from './viewShared';
import { ContextEntries, type MenuEntry } from './menuEntries';
import { ViewLoadFeedback } from './ViewLoadFeedback';

type Props = {
  projectId: string;
  projectName?: string;
  memberCount?: number;
  filters: ViewFilters;
  mode: 'month' | 'week';
  onModeChange: (m: 'month' | 'week') => void;
  createRequest: ViewCreateRequest | null;
  canEdit?: boolean;
};

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

// 'YYYY-MM-DD' → локальная дата (без TZ-сдвигов new Date(string)).
function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

// Сдвиг date-строки на delta дней.
function shiftYmd(s: string, delta: number): string {
  return ymd(addDays(parseYmd(s), delta));
}

// Дней между двумя date-строками (b - a).
function diffDays(a: string, b: string): number {
  return Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 86400000);
}

// Непрерывная сетка недель нескольких месяцев подряд — бесконечный скролл вниз
// (Notion): от понедельника недели 1-го числа base до воскресенья недели последнего
// дня base+months-1.
function buildRangeGrid(base: Date, months: number): Date[] {
  const first = new Date(base.getFullYear(), base.getMonth(), 1);
  const dow = (first.getDay() + 6) % 7; // 0=Пн … 6=Вс
  const start = addDays(first, -dow);
  const lastDay = new Date(base.getFullYear(), base.getMonth() + months, 0);
  const endDow = (lastDay.getDay() + 6) % 7;
  const end = addDays(lastDay, 6 - endDow);
  const out: Date[] = [];
  for (let d = start; d.getTime() <= end.getTime(); d = addDays(d, 1)) out.push(d);
  return out;
}

// Ключ месяца для скролл-навигации ‹ › и подписи в шапке.
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Неделя (Notion Week view): 7 дней с понедельника недели, содержащей anchor.
function buildWeekGrid(anchor: Date): Date[] {
  const dow = (anchor.getDay() + 6) % 7;
  const start = addDays(startOfDay(anchor), -dow);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

// === Календарный вид доски (Notion-style, план board-views-design) ===
// Сетка месяца, задачи в день дедлайна. Drag чипа на другой день = смена дедлайна;
// клик — окно задачи; hover-«+» в ячейке — создать задачу с этим сроком;
// «Без срока (N)» — поповер со списком (оттуда тоже можно тащить на дни).
export function CalendarView({
  projectId,
  projectName,
  memberCount,
  filters,
  mode,
  onModeChange,
  createRequest,
  canEdit = true,
}: Props): React.ReactElement {
  const tasksApi = useTasks(projectId);
  const { tasks: allTasks, loading, error, update, move, create, remove, refetch } = tasksApi;
  const { taskTemplateRepository } = useContainer();
  const tasks = useMemo(() => allTasks.filter((t) => matchesFilters(t, filters)), [allTasks, filters]);
  const isShared = (memberCount ?? 0) > 1;
  const [monthStart, setMonthStart] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [drawer, setDrawer] = useState<TaskDrawerState | null>(null);
  // Создание из ячейки: дедлайн дня подмешивается при сабмите create-формы drawer'а.
  const [pendingDeadline, setPendingDeadline] = useState<string | null>(null);
  const [activeDrag, setActiveDrag] = useState<Task | null>(null);

  // «Создать» из тулбара вью (срок не задан — попадёт в «Без срока»).
  // С шаблоном (db/108) — задача создаётся сразу, без окна.
  useEffect(() => {
    if (!createRequest || !canEdit) return;
    const tpl = createRequest.template;
    if (tpl) {
      void create({
        description: tpl.description || tpl.name,
        status: tpl.status,
        priority: tpl.priority,
        icon: tpl.icon,
      })
        .then(() => toast.success(`Создано из шаблона «${tpl.name}»`))
        .catch((e: unknown) => toast.error(`Не удалось: ${(e as Error).message}`));
    } else {
      setDrawer({ mode: 'create', status: createRequest.status });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequest, canEdit]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  // Сегменты полос (Notion date range): задача с startDate < deadline занимает каждый
  // день диапазона; seg определяет скругление краёв и где рисовать текст.
  const byDay = useMemo(() => {
    const map = new Map<string, { task: Task; seg: 'single' | 'start' | 'mid' | 'end' }[]>();
    const push = (day: string, item: { task: Task; seg: 'single' | 'start' | 'mid' | 'end' }): void => {
      const arr = map.get(day);
      if (arr) arr.push(item);
      else map.set(day, [item]);
    };
    for (const t of tasks) {
      if (!t.deadline) continue;
      if (t.startDate && t.startDate < t.deadline) {
        let d = parseYmd(t.startDate);
        const end = parseYmd(t.deadline);
        // Safety-cap 90 дней — битые данные не должны вешать рендер.
        for (let i = 0; i < 90 && d <= end; i++, d = addDays(d, 1)) {
          const key = ymd(d);
          push(key, {
            task: t,
            seg: key === t.startDate ? 'start' : key === t.deadline ? 'end' : 'mid',
          });
        }
      } else {
        push(t.deadline, { task: t, seg: 'single' });
      }
    }
    for (const arr of map.values())
      arr.sort(
        (a, b) =>
          // Полосы выше одиночных (стабильные «дорожки»), внутри — по id/позиции.
          Number(a.seg === 'single') - Number(b.seg === 'single') ||
          a.task.id.localeCompare(b.task.id) ||
          a.task.position - b.task.position,
      );
    return map;
  }, [tasks]);
  const noDate = useMemo(() => tasks.filter((t) => !t.deadline), [tasks]);

  // Месячный режим — бесконечный скролл: рендерим monthCount месяцев одной
  // непрерывной сеткой, при подходе к низу догружаем ещё (Notion).
  const [monthCount, setMonthCount] = useState(3);
  const [visibleMonth, setVisibleMonth] = useState<Date>(monthStart);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Месяц, к которому нужно проскроллить после рендера (стрелки ‹ › / «Сегодня»).
  const [pendingScroll, setPendingScroll] = useState<string | null>(null);

  const days = useMemo(
    () => (mode === 'week' ? buildWeekGrid(monthStart) : buildRangeGrid(monthStart, monthCount)),
    [monthStart, mode, monthCount],
  );
  const todayYmd = ymd(startOfDay(new Date()));
  const monthLabel =
    mode === 'week'
      ? `${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(days[0])} — ${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(days[6])}`
      : new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(visibleMonth);

  // Подпись месяца в шапке следует за скроллом: первый заголовок «1-е число»,
  // видимый в верхней части контейнера.
  const handleCalScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 600) {
      setMonthCount((c) => Math.min(c + 2, 36));
    }
    const top = el.getBoundingClientRect().top;
    const anchors = el.querySelectorAll<HTMLElement>('[data-month-anchor]');
    let current: string | null = null;
    for (const a of anchors) {
      if (a.getBoundingClientRect().top <= top + 80) current = a.dataset['monthAnchor'] ?? null;
      else break;
    }
    if (current) {
      const [y, m] = current.split('-').map(Number);
      if (y && m) {
        setVisibleMonth((prev) =>
          prev.getFullYear() === y && prev.getMonth() === m - 1 ? prev : new Date(y, m - 1, 1),
        );
      }
    }
  };

  // Скролл к месяцу после того, как он появился в сетке.
  useEffect(() => {
    if (!pendingScroll || mode === 'week') return;
    const el = scrollRef.current?.querySelector<HTMLElement>(
      `[data-month-anchor="${pendingScroll}"]`,
    );
    if (el) {
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      setPendingScroll(null);
    }
  }, [pendingScroll, days, mode]);

  // Навигация ‹ › (месячный режим): скроллим к соседнему месяцу; назад за базу —
  // сдвигаем базу, вперёд за диапазон — догружаем месяцы.
  const goToMonth = (target: Date): void => {
    const key = monthKey(target);
    const baseIdx =
      (target.getFullYear() - monthStart.getFullYear()) * 12 +
      (target.getMonth() - monthStart.getMonth());
    if (baseIdx < 0) {
      setMonthStart(new Date(target.getFullYear(), target.getMonth(), 1));
      setVisibleMonth(new Date(target.getFullYear(), target.getMonth(), 1));
      scrollRef.current?.scrollTo({ top: 0 });
      return;
    }
    if (baseIdx >= monthCount) setMonthCount(Math.min(baseIdx + 2, 36));
    setPendingScroll(key);
  };

  // Контекстное меню чипа задачи (правая кнопка) — как у строк таблицы/списка.
  const menuFor = (task: Task): MenuEntry[] =>
    taskMenuEntries(task, projectId, {
      onOpen: () => setDrawer({ mode: 'edit', task }),
      onStatus: (s) =>
        void move(task.id, { targetStatus: s, beforeTaskId: null, afterTaskId: null }).catch(
          (e: unknown) => toast.error(`Не удалось: ${(e as Error).message}`),
        ),
      onPriority: (p) =>
        void update(task.id, { priority: p }).catch((e: unknown) =>
          toast.error(`Не удалось: ${(e as Error).message}`),
        ),
      onDeadline: (d) =>
        void update(task.id, { deadline: d }).catch((e: unknown) =>
          toast.error(`Не удалось: ${(e as Error).message}`),
        ),
      onStartDate: (d) =>
        void update(task.id, { startDate: d }).catch((e: unknown) =>
          toast.error(`Не удалось: ${(e as Error).message}`),
        ),
      onDuplicate: () =>
        void create({
          description: task.description ?? '',
          status: task.status,
          deadline: task.deadline ?? undefined,
          priority: task.priority ?? undefined,
        }).catch((e: unknown) => toast.error(`Не удалось: ${(e as Error).message}`)),
      onSaveTemplate: () =>
        void taskTemplateRepository
          .create(projectId, {
            name: taskTitle(task).slice(0, 64),
            description: task.description ?? '',
            status: task.status,
            priority: task.priority,
            icon: task.icon,
          })
          .then(() => toast.success('Шаблон сохранён — доступен в меню «Создать ▾»'))
          .catch((e: unknown) => toast.error(`Не удалось: ${(e as Error).message}`)),
      onDelete: () =>
        void remove(task.id)
          .then(() => toast.success('Задача удалена'))
          .catch((e: unknown) => toast.error(`Не удалось: ${(e as Error).message}`)),
    });

  const handleDragEnd = (e: DragEndEvent): void => {
    if (!canEdit) return;
    setActiveDrag(null);
    const data = e.active.data.current as
      | { type?: string; task?: Task; fromDay?: string }
      | undefined;
    const task = data?.task;
    const day = e.over?.data.current?.day as string | undefined;
    if (!task || !day) return;
    const fail = (err: unknown): void => {
      toast.error(`Не удалось: ${(err as Error).message}`);
    };
    // Resize краями полосы (Notion): левая ручка — дата начала, правая — срок.
    if (data?.type === 'resize-start') {
      if (task.deadline && day > task.deadline) {
        void update(task.id, { startDate: task.deadline, deadline: day }).catch(fail);
      } else if (day === task.deadline) {
        void update(task.id, { startDate: null }).catch(fail);
      } else {
        void update(task.id, { startDate: day }).catch(fail);
      }
      return;
    }
    if (data?.type === 'resize-end') {
      if (task.startDate && day < task.startDate) {
        void update(task.id, { startDate: day, deadline: task.startDate }).catch(fail);
      } else if (day === task.startDate) {
        void update(task.id, { startDate: null, deadline: day }).catch(fail);
      } else {
        void update(task.id, { deadline: day }).catch(fail);
      }
      return;
    }
    // Перенос: диапазон сдвигается целиком (delta от дня, за который тянули).
    if (task.startDate && task.deadline && task.startDate < task.deadline) {
      const from = data?.fromDay ?? task.deadline;
      const delta = diffDays(from, day);
      if (delta === 0) return;
      void update(task.id, {
        startDate: shiftYmd(task.startDate, delta),
        deadline: shiftYmd(task.deadline, delta),
      }).catch(fail);
      return;
    }
    if (task.deadline === day) return;
    void update(task.id, { deadline: day }).catch(fail);
  };

  if (loading) return <div className="h-72 animate-pulse rounded-xl bg-muted/60" />;
  if (error && allTasks.length === 0) {
    return <ViewLoadFeedback error={error} hasData={false} onRetry={refetch} label="календарь" />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewLoadFeedback
        error={error}
        hasData={allTasks.length > 0}
        onRetry={refetch}
        label="календарь"
      />
      {/* Шапка: месяц + «Без срока (N)» + навигация ‹ Сегодня ›. */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
        <p className="text-sm font-semibold capitalize">{monthLabel}</p>
        <div className="flex items-center gap-1">
          {/* Переключатель Месяц/Неделя (Notion Week view). */}
          <div className="mr-1 inline-flex overflow-hidden rounded-md border">
            {(
              [
                ['month', 'Месяц'],
                ['week', 'Неделя'],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => onModeChange(m)}
                className={cn(
                  'px-2 py-0.5 text-xs transition-colors',
                  mode === m ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/50',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {noDate.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <CalendarOff className="size-3.5" />
                  Без срока ({noDate.length})
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="max-h-80 w-72 overflow-y-auto p-1.5">
                <p className="px-1.5 pb-1.5 text-[11px] text-muted-foreground">
                  Перетащите на день календаря, чтобы назначить срок
                </p>
                <div className="flex flex-col gap-0.5">
                  {noDate.map((t) => (
                    <TaskChip
                      key={t.id}
                      task={t}
                      onOpen={() => setDrawer({ mode: 'edit', task: t })}
                      menu={menuFor(t)}
                    />
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={mode === 'week' ? 'Предыдущая неделя' : 'Предыдущий месяц'}
            onClick={() => {
              if (mode === 'week') setMonthStart((m) => addDays(m, -7));
              else
                goToMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1));
            }}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => {
              const now = new Date();
              if (mode === 'week') setMonthStart(startOfDay(now));
              else goToMonth(new Date(now.getFullYear(), now.getMonth(), 1));
            }}
          >
            Сегодня
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={mode === 'week' ? 'Следующая неделя' : 'Следующий месяц'}
            onClick={() => {
              if (mode === 'week') setMonthStart((m) => addDays(m, 7));
              else
                goToMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1));
            }}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <DndContext
        sensors={canEdit ? sensors : []}
        collisionDetection={pointerWithin}
        onDragStart={(e) => setActiveDrag((e.active.data.current?.task as Task | undefined) ?? null)}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveDrag(null)}
      >
        {/* Дни недели. */}
        <div className="grid grid-cols-7 border-b text-center text-[11px] text-muted-foreground">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-1">
              {d}
            </div>
          ))}
        </div>
        {/* Сетка: месяцы непрерывной лентой с бесконечным скроллом вниз (Notion)
            или одна неделя (высокие ячейки). Чередующиеся месяцы слегка затенены. */}
        <div
          ref={scrollRef}
          onScroll={mode === 'week' ? undefined : handleCalScroll}
          className={cn('grid grid-cols-7', mode !== 'week' && 'max-h-[70vh] overflow-y-auto')}
        >
          {days.map((day) => (
            <DayCell
              key={ymd(day)}
              day={day}
              inMonth={mode === 'week' || day.getMonth() % 2 === 0}
              isToday={ymd(day) === todayYmd}
              tall={mode === 'week'}
              monthAnchor={mode !== 'week' && day.getDate() === 1 ? monthKey(day) : undefined}
              tasks={byDay.get(ymd(day)) ?? []}
              dragging={activeDrag !== null}
              onOpen={(t) => setDrawer({ mode: 'edit', task: t })}
              menuFor={menuFor}
              onCreate={() => {
                setPendingDeadline(ymd(day));
                setDrawer({ mode: 'create', status: 'backlog' });
              }}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeDrag ? (
            <div className="pointer-events-none max-w-[12rem] truncate rounded-md border border-primary/40 bg-card px-2 py-1 text-xs shadow-lg ring-1 ring-primary/20">
              {taskTitle(activeDrag)}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Окно задачи. Для create подмешиваем дедлайн выбранного дня. */}
      {pendingDeadline && drawer?.mode === 'create' ? (
        <ViewTaskDrawerWithDeadline
          state={drawer}
          onClose={() => {
            setDrawer(null);
            setPendingDeadline(null);
          }}
          projectId={projectId}
          projectName={projectName}
          isShared={isShared}
          tasksApi={tasksApi}
          deadline={pendingDeadline}
          canEdit={canEdit}
        />
      ) : (
        <ViewTaskDrawer
          state={drawer}
          onClose={() => setDrawer(null)}
          projectId={projectId}
          projectName={projectName}
          isShared={isShared}
          tasksApi={tasksApi}
          canEdit={canEdit}
        />
      )}

      {/* Быстрое создание без дня (попадёт в «Без срока»). */}
      {canEdit && <div className="max-w-xs py-2">
        <NewTaskRow create={tasksApi.create} />
      </div>}
    </div>
  );
}

function ViewTaskDrawerWithDeadline({
  state,
  onClose,
  projectId,
  projectName,
  isShared,
  tasksApi,
  deadline,
  canEdit,
}: {
  state: TaskDrawerState;
  onClose: () => void;
  projectId: string;
  projectName?: string;
  isShared: boolean;
  tasksApi: ReturnType<typeof useTasks>;
  deadline: string;
  canEdit: boolean;
}): React.ReactElement {
  // Обёртка над tasksApi: create получает дедлайн дня, из которого нажали «+».
  const patched = useMemo(
    () => ({
      ...tasksApi,
      create: (input: Parameters<typeof tasksApi.create>[0]) =>
        tasksApi.create({ ...input, deadline: input.deadline ?? deadline }),
    }),
    [tasksApi, deadline],
  );
  return (
    <ViewTaskDrawer
      state={state}
      onClose={onClose}
      projectId={projectId}
      projectName={projectName}
      isShared={isShared}
      tasksApi={patched}
      canEdit={canEdit}
    />
  );
}

type DayItem = { task: Task; seg: 'single' | 'start' | 'mid' | 'end' };

function DayCell({
  day,
  inMonth,
  isToday,
  tall = false,
  monthAnchor,
  tasks,
  dragging,
  onOpen,
  onCreate,
  menuFor,
}: {
  day: Date;
  // Чередование фона месяцев в непрерывной ленте (Notion) / приглушение в неделе.
  inMonth: boolean;
  isToday: boolean;
  tall?: boolean;
  // YYYY-MM у 1-го числа месяца: якорь скролл-навигации ‹ › + подпись «1 июл».
  monthAnchor?: string;
  tasks: DayItem[];
  dragging: boolean;
  onOpen: (t: Task) => void;
  onCreate: () => void;
  menuFor: (t: Task) => MenuEntry[];
}): React.ReactElement {
  const key = ymd(day);
  const { setNodeRef, isOver } = useDroppable({ id: `day-${key}`, data: { day: key } });
  const MAX_CHIPS = tall ? 24 : 3;
  const hidden = tasks.length - MAX_CHIPS;
  return (
    <div
      ref={setNodeRef}
      data-month-anchor={monthAnchor}
      className={cn(
        'group/cell relative border-b border-r p-1 first:border-l [&:nth-child(7n+1)]:border-l',
        tall ? 'min-h-[24rem]' : 'min-h-24',
        !inMonth && 'bg-muted/20',
        dragging && isOver && 'bg-primary/10 ring-2 ring-inset ring-primary/40',
      )}
    >
      {/* Notion-порядок: «+» слева при hover, число дня — в правом верхнем углу
          (у 1-го числа — с месяцем), сегодня — красный кружок. */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onCreate}
          aria-label="Создать задачу в этот день"
          className="grid size-5 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover/cell:opacity-100"
        >
          <Plus className="size-3.5" />
        </button>
        <span
          className={cn(
            'inline-flex h-5 items-center justify-center rounded-full text-[11px]',
            isToday ? 'size-5 bg-red-500 font-semibold text-white' : 'text-muted-foreground',
            monthAnchor && !isToday && 'px-1 font-medium text-foreground',
          )}
        >
          {monthAnchor
            ? `${day.getDate()} ${new Intl.DateTimeFormat('ru-RU', { month: 'short' }).format(day)}`
            : day.getDate()}
        </span>
      </div>
      <div className="mt-0.5 flex flex-col gap-0.5">
        {tasks.slice(0, MAX_CHIPS).map(({ task: t, seg }) => (
          <TaskChip
            key={t.id}
            task={t}
            seg={seg}
            fromDay={key}
            showLabel={seg === 'single' || seg === 'start' || day.getDay() === 1}
            onOpen={() => onOpen(t)}
            menu={menuFor(t)}
          />
        ))}
        {hidden > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="rounded px-1 text-left text-[10px] text-muted-foreground hover:bg-accent"
              >
                ещё {hidden}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="max-h-72 w-64 overflow-y-auto p-1.5">
              <div className="flex flex-col gap-0.5">
                {tasks.map(({ task: t }) => (
                  <TaskChip key={t.id} task={t} fromDay={key} onOpen={() => onOpen(t)} menu={menuFor(t)} />
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}

// Ручка resize на краю полосы (Notion): drag на день меняет дату начала/срок.
function EdgeHandle({
  task,
  side,
}: {
  task: Task;
  side: 'resize-start' | 'resize-end';
}): React.ReactElement {
  const { setNodeRef, listeners, attributes } = useDraggable({
    id: `${task.id}::${side}`,
    data: { type: side, task },
  });
  return (
    <span
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      role="separator"
      aria-label={side === 'resize-start' ? 'Изменить дату начала' : 'Изменить срок'}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'absolute top-0 z-10 h-full w-1.5 cursor-ew-resize rounded opacity-0 transition-opacity group-hover/chip:opacity-100 hover:bg-primary/50',
        side === 'resize-start' ? 'left-0' : 'right-0',
      )}
    />
  );
}

// Чип задачи: draggable (перенос дедлайна/сдвиг диапазона) + клик открывает окно
// (порог 6px разводит их); правая кнопка — меню; края полосы тянутся (resize).
function TaskChip({
  task,
  seg = 'single',
  fromDay,
  showLabel = true,
  onOpen,
  menu,
}: {
  task: Task;
  seg?: 'single' | 'start' | 'mid' | 'end';
  fromDay?: string;
  showLabel?: boolean;
  onOpen: () => void;
  menu?: MenuEntry[];
}): React.ReactElement {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: fromDay ? `${task.id}@${fromDay}` : task.id,
    data: { type: 'move', task, fromDay },
  });
  const chip = (
    <div className="group/chip relative" data-pf-task-id={task.id}>
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        onClick={onOpen}
        className={cn(
          'flex cursor-pointer items-center gap-1 border bg-card px-1.5 py-0.5 text-xs shadow-sm transition-colors hover:bg-accent',
          // Сегменты полосы (Notion date range): скругление только на краях диапазона.
          seg === 'single' && 'rounded-md',
          seg === 'start' && '-mr-1 rounded-l-md rounded-r-none border-r-0',
          seg === 'mid' && '-mx-1 rounded-none border-x-0',
          seg === 'end' && '-ml-1 rounded-l-none rounded-r-md border-l-0',
          isDragging && 'opacity-30',
          task.status === 'done' && 'text-muted-foreground line-through decoration-muted-foreground/40',
        )}
      >
        {showLabel ? (
          <>
            <span className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[task.status])} />
            {task.icon ? (
              <span className="grid size-3.5 shrink-0 place-items-center overflow-hidden">
                <ProjectIconView icon={task.icon} pixelSize={12} className="text-[11px]" />
              </span>
            ) : (
              <FileText className="size-3 shrink-0 text-muted-foreground/50" />
            )}
            <span className="min-w-0 truncate">{taskTitle(task)}</span>
          </>
        ) : (
          <span className="h-4 min-w-0 flex-1" aria-hidden />
        )}
      </div>
      {(seg === 'single' || seg === 'start') && <EdgeHandle task={task} side="resize-start" />}
      {(seg === 'single' || seg === 'end') && <EdgeHandle task={task} side="resize-end" />}
    </div>
  );
  if (!menu) return chip;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{chip}</ContextMenuTrigger>
      <ContextMenuContent
        className="min-w-[12rem]"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <ContextEntries entries={menu} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
