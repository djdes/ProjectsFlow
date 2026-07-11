import { useEffect, useMemo, useState } from 'react';
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
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { Task } from '@/domain/task/Task';
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
  taskTitle,
  type ViewFilters,
} from './viewShared';

type Props = {
  projectId: string;
  projectName?: string;
  memberCount?: number;
  filters: ViewFilters;
  createRequest: ViewCreateRequest | null;
};

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

// Сетка месяца: 6 недель с понедельника (полные ряды — соседние месяцы приглушены).
function buildMonthGrid(monthStart: Date): Date[] {
  const first = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
  const dow = (first.getDay() + 6) % 7; // 0=Пн … 6=Вс
  const gridStart = addDays(first, -dow);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
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
  createRequest,
}: Props): React.ReactElement {
  const tasksApi = useTasks(projectId);
  const { tasks: allTasks, loading, error, update } = tasksApi;
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
  useEffect(() => {
    if (createRequest) setDrawer({ mode: 'create', status: createRequest.status });
  }, [createRequest]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.deadline) continue;
      const arr = map.get(t.deadline);
      if (arr) arr.push(t);
      else map.set(t.deadline, [t]);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.position - b.position);
    return map;
  }, [tasks]);
  const noDate = useMemo(() => tasks.filter((t) => !t.deadline), [tasks]);

  const days = useMemo(() => buildMonthGrid(monthStart), [monthStart]);
  const todayYmd = ymd(startOfDay(new Date()));
  const monthLabel = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(
    monthStart,
  );

  const handleDragEnd = (e: DragEndEvent): void => {
    setActiveDrag(null);
    const task = e.active.data.current?.task as Task | undefined;
    const day = e.over?.data.current?.day as string | undefined;
    if (!task || !day || task.deadline === day) return;
    void update(task.id, { deadline: day }).catch((err: unknown) =>
      toast.error(`Не удалось перенести срок: ${(err as Error).message}`),
    );
  };

  if (loading) return <div className="h-72 animate-pulse rounded-xl bg-muted/60" />;
  if (error) return <p className="text-sm text-destructive">{error}</p>;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Шапка: месяц + «Без срока (N)» + навигация ‹ Сегодня ›. */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
        <p className="text-sm font-semibold capitalize">{monthLabel}</p>
        <div className="flex items-center gap-1">
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
                    <TaskChip key={t.id} task={t} onOpen={() => setDrawer({ mode: 'edit', task: t })} />
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Предыдущий месяц"
            onClick={() =>
              setMonthStart((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))
            }
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => {
              const now = new Date();
              setMonthStart(new Date(now.getFullYear(), now.getMonth(), 1));
            }}
          >
            Сегодня
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Следующий месяц"
            onClick={() =>
              setMonthStart((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))
            }
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
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
        {/* Сетка 6×7. */}
        <div className="grid grid-cols-7">
          {days.map((day) => (
            <DayCell
              key={ymd(day)}
              day={day}
              inMonth={day.getMonth() === monthStart.getMonth()}
              isToday={ymd(day) === todayYmd}
              tasks={byDay.get(ymd(day)) ?? []}
              dragging={activeDrag !== null}
              onOpen={(t) => setDrawer({ mode: 'edit', task: t })}
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
        />
      ) : (
        <ViewTaskDrawer
          state={drawer}
          onClose={() => setDrawer(null)}
          projectId={projectId}
          projectName={projectName}
          isShared={isShared}
          tasksApi={tasksApi}
        />
      )}

      {/* Быстрое создание без дня (попадёт в «Без срока»). */}
      <div className="max-w-xs py-2">
        <NewTaskRow create={tasksApi.create} />
      </div>
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
}: {
  state: TaskDrawerState;
  onClose: () => void;
  projectId: string;
  projectName?: string;
  isShared: boolean;
  tasksApi: ReturnType<typeof useTasks>;
  deadline: string;
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
    />
  );
}

function DayCell({
  day,
  inMonth,
  isToday,
  tasks,
  dragging,
  onOpen,
  onCreate,
}: {
  day: Date;
  inMonth: boolean;
  isToday: boolean;
  tasks: Task[];
  dragging: boolean;
  onOpen: (t: Task) => void;
  onCreate: () => void;
}): React.ReactElement {
  const key = ymd(day);
  const { setNodeRef, isOver } = useDroppable({ id: `day-${key}`, data: { day: key } });
  const MAX_CHIPS = 3;
  const hidden = tasks.length - MAX_CHIPS;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'group/cell relative min-h-24 border-b border-r p-1 first:border-l [&:nth-child(7n+1)]:border-l',
        !inMonth && 'bg-muted/20',
        dragging && isOver && 'bg-primary/10 ring-2 ring-inset ring-primary/40',
      )}
    >
      {/* Notion-порядок: «+» слева при hover, число дня — в правом верхнем углу,
          сегодня — красный кружок. */}
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
            'inline-flex size-5 items-center justify-center rounded-full text-[11px]',
            isToday ? 'bg-red-500 font-semibold text-white' : 'text-muted-foreground',
            !inMonth && !isToday && 'text-muted-foreground/40',
          )}
        >
          {day.getDate()}
        </span>
      </div>
      <div className="mt-0.5 flex flex-col gap-0.5">
        {tasks.slice(0, MAX_CHIPS).map((t) => (
          <TaskChip key={t.id} task={t} onOpen={() => onOpen(t)} />
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
                {tasks.map((t) => (
                  <TaskChip key={t.id} task={t} onOpen={() => onOpen(t)} />
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}

// Чип задачи: draggable (перенос дедлайна) + клик открывает окно (порог 6px разводит их).
function TaskChip({ task, onOpen }: { task: Task; onOpen: () => void }): React.ReactElement {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: task.id,
    data: { type: 'task', task },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onOpen}
      className={cn(
        'flex cursor-pointer items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-xs shadow-sm transition-colors hover:bg-accent',
        isDragging && 'opacity-30',
        task.status === 'done' && 'text-muted-foreground line-through decoration-muted-foreground/40',
      )}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[task.status])} />
      {task.icon ? (
        <span className="grid size-3.5 shrink-0 place-items-center overflow-hidden">
          <ProjectIconView icon={task.icon} pixelSize={12} className="text-[11px]" />
        </span>
      ) : (
        <FileText className="size-3 shrink-0 text-muted-foreground/50" />
      )}
      <span className="min-w-0 truncate">{taskTitle(task)}</span>
    </div>
  );
}
