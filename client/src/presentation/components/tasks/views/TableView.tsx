import { useMemo, useRef, useState } from 'react';
import { CalendarClock, ChevronDown, FileText } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { Task, TaskPriority, TaskStatus } from '@/domain/task/Task';
import { TASK_PRIORITIES } from '@/domain/task/Task';
import { PRIORITY_META } from '@/domain/task/priorityMeta';
import { VISIBLE_KANBAN_STATUSES } from '@/domain/kanban/KanbanSettings';
import { useTasks } from '@/presentation/hooks/useTasks';
import { useBulkTaskActions } from '@/presentation/hooks/useBulkTaskActions';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { ProjectIconView } from '@/presentation/components/project/projectIconView';
import { STATUS_LABEL } from '../statusLabels';
import { DeadlineBadge } from '../DeadlineBadge';
import { DelegateTaskButton } from '../DelegateTaskButton';
import { BulkActionBar } from '../BulkActionBar';
import { type TaskDrawerState } from '../TaskDrawer';
import { ymd, startOfDay, addDays } from '../assignedGrouping';
import {
  NewTaskRow,
  STATUS_DOT,
  ViewSearchInput,
  ViewTaskDrawer,
  matchesQuery,
  sortBoardTasks,
  taskTitle,
} from './viewShared';

type Props = {
  projectId: string;
  projectName?: string;
  memberCount?: number;
};

// Сетка колонок: Название (тянется) / Статус / Приоритет / Срок / Ответственный.
const GRID = 'grid grid-cols-[minmax(0,1fr)_8.5rem_8rem_8.5rem_11rem]';

// === Табличный вид доски (Notion-style, план board-views-design) ===
// Строки задач с вертикальными линиями; статус/приоритет/срок/ответственный редактируются
// прямо в ячейках; клик по названию открывает окно задачи; чекбоксы → BulkActionBar.
export function TableView({ projectId, projectName, memberCount }: Props): React.ReactElement {
  const tasksApi = useTasks(projectId);
  const { tasks, loading, error, create, update, move, remove, refetch } = tasksApi;
  const { user } = useCurrentUser();
  const isShared = (memberCount ?? 0) > 1;
  const [query, setQuery] = useState('');
  const [drawer, setDrawer] = useState<TaskDrawerState | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const bulk = useBulkTaskActions({ projectId, update, move, remove, refetch });

  const rows = useMemo(
    () => sortBoardTasks(tasks).filter((t) => matchesQuery(t, query)),
    [tasks, query],
  );

  const toggleSelected = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) return <div className="h-64 animate-pulse rounded-xl bg-muted/60" />;
  if (error) return <p className="text-sm text-destructive">{error}</p>;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 pb-2">
        <ViewSearchInput value={query} onChange={setQuery} />
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[52rem]">
          {/* Шапка таблицы. */}
          <div className={cn(GRID, 'border-b text-xs text-muted-foreground')}>
            <div className="px-2 py-1.5">Название</div>
            <div className="border-l px-2 py-1.5">Статус</div>
            <div className="border-l px-2 py-1.5">Приоритет</div>
            <div className="border-l px-2 py-1.5">Срок</div>
            <div className="border-l px-2 py-1.5">Ответственный</div>
          </div>

          {rows.map((task) => (
            <TableRow
              key={task.id}
              task={task}
              selected={selected.has(task.id)}
              onToggleSelected={() => toggleSelected(task.id)}
              onOpen={() => setDrawer({ mode: 'edit', task })}
              onStatus={(s) =>
                void move(task.id, { targetStatus: s, beforeTaskId: null, afterTaskId: null }).catch(
                  (e: unknown) => toast.error(`Не удалось: ${(e as Error).message}`),
                )
              }
              onPriority={(p) =>
                void update(task.id, { priority: p }).catch((e: unknown) =>
                  toast.error(`Не удалось: ${(e as Error).message}`),
                )
              }
              onDeadline={(d) =>
                void update(task.id, { deadline: d }).catch((e: unknown) =>
                  toast.error(`Не удалось: ${(e as Error).message}`),
                )
              }
              currentUserId={user?.id ?? null}
              projectId={projectId}
              onChanged={() => void refetch()}
            />
          ))}

          {rows.length === 0 && (
            <p className="px-2 py-6 text-sm text-muted-foreground">
              {query ? 'Под фильтр ничего не попадает.' : 'Задач пока нет.'}
            </p>
          )}

          <div className="border-b py-1">
            <NewTaskRow create={create} />
          </div>
        </div>
      </div>

      <ViewTaskDrawer
        state={drawer}
        onClose={() => setDrawer(null)}
        projectId={projectId}
        projectName={projectName}
        isShared={isShared}
        tasksApi={tasksApi}
      />

      {selected.size > 0 && (
        <BulkActionBar
          selectedIds={rows.filter((t) => selected.has(t.id)).map((t) => t.id)}
          projectId={projectId}
          isInbox={false}
          currentUserId={user?.id ?? null}
          moveTargets={VISIBLE_KANBAN_STATUSES.map((s) => ({ status: s, label: STATUS_LABEL[s] }))}
          bulk={bulk}
          onExit={() => setSelected(new Set())}
        />
      )}
    </div>
  );
}

function TableRow({
  task,
  selected,
  onToggleSelected,
  onOpen,
  onStatus,
  onPriority,
  onDeadline,
  currentUserId,
  projectId,
  onChanged,
}: {
  task: Task;
  selected: boolean;
  onToggleSelected: () => void;
  onOpen: () => void;
  onStatus: (s: TaskStatus) => void;
  onPriority: (p: TaskPriority | null) => void;
  onDeadline: (d: string | null) => void;
  currentUserId: string | null;
  projectId: string;
  onChanged: () => void;
}): React.ReactElement {
  return (
    <div
      className={cn(
        GRID,
        'group border-b transition-colors hover:bg-accent/40',
        selected && 'bg-primary/5',
      )}
    >
      {/* Название: чекбокс (hover/выбрано) + иконка + заголовок. */}
      <div className="flex min-w-0 items-center gap-1.5 px-2 py-1.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelected}
          onClick={(e) => e.stopPropagation()}
          aria-label="Выбрать задачу"
          className={cn(
            'size-3.5 shrink-0 cursor-pointer accent-primary transition-opacity',
            selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        />
        {task.icon ? (
          <span className="grid size-4 shrink-0 place-items-center overflow-hidden">
            <ProjectIconView icon={task.icon} pixelSize={15} className="text-sm" />
          </span>
        ) : (
          <FileText className="size-4 shrink-0 text-muted-foreground/60" />
        )}
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 truncate text-left text-sm hover:underline"
        >
          {taskTitle(task)}
        </button>
      </div>

      {/* Статус. */}
      <div className="border-l px-1 py-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-md px-1.5 text-xs text-foreground/90 transition-colors hover:bg-accent"
            >
              <span className={cn('size-2 shrink-0 rounded-full', STATUS_DOT[task.status])} />
              <span className="truncate">{STATUS_LABEL[task.status]}</span>
              <ChevronDown className="size-3 shrink-0 opacity-0 group-hover:opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[10rem]">
            {VISIBLE_KANBAN_STATUSES.map((s) => (
              <DropdownMenuItem key={s} className="gap-2" onClick={() => onStatus(s)}>
                <span className={cn('size-2 rounded-full', STATUS_DOT[s])} />
                {STATUS_LABEL[s]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Приоритет. */}
      <div className="border-l px-1 py-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-md px-1.5 text-xs transition-colors hover:bg-accent"
            >
              {task.priority !== null && task.priority !== undefined ? (
                <>
                  <span
                    className={cn('size-2 shrink-0 rounded-full', PRIORITY_META[task.priority].dotColor)}
                  />
                  <span className="truncate">{PRIORITY_META[task.priority].label}</span>
                </>
              ) : (
                <span className="text-muted-foreground/60">—</span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[10rem]">
            {TASK_PRIORITIES.map((p) => (
              <DropdownMenuItem key={p} className="gap-2" onClick={() => onPriority(p)}>
                <span className={cn('size-2 rounded-full', PRIORITY_META[p].dotColor)} />
                {PRIORITY_META[p].label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-muted-foreground" onClick={() => onPriority(null)}>
              Без приоритета
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Срок. */}
      <div className="border-l px-1 py-1">
        <DeadlineCell task={task} onDeadline={onDeadline} />
      </div>

      {/* Ответственный — существующий селектор «создатель → исполнитель». */}
      <div className="min-w-0 border-l px-1 py-1">
        <DelegateTaskButton
          task={task}
          currentUserId={currentUserId}
          onChanged={onChanged}
          projectId={projectId}
          className="h-6 max-w-full justify-start px-1.5 text-xs"
        />
      </div>
    </div>
  );
}

// Ячейка срока: чип с бейджем/«—», меню Сегодня/Завтра/Выбрать дату…/Убрать.
function DeadlineCell({
  task,
  onDeadline,
}: {
  task: Task;
  onDeadline: (d: string | null) => void;
}): React.ReactElement {
  const dateRef = useRef<HTMLInputElement>(null);
  const openPicker = (): void => {
    const inp = dateRef.current;
    if (!inp) return;
    if (typeof inp.showPicker === 'function') {
      try {
        inp.showPicker();
      } catch {
        inp.focus();
      }
    } else inp.focus();
  };
  const today = ymd(startOfDay(new Date()));
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-md px-1.5 text-xs transition-colors hover:bg-accent"
          >
            {task.deadline ? (
              <DeadlineBadge deadline={task.deadline} status={task.status} />
            ) : (
              <span className="flex items-center gap-1 text-muted-foreground/60">
                <CalendarClock className="size-3" />—
              </span>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[10rem]">
          <DropdownMenuItem onClick={() => onDeadline(today)}>Сегодня</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onDeadline(ymd(addDays(startOfDay(new Date()), 1)))}>
            Завтра
          </DropdownMenuItem>
          <DropdownMenuItem onClick={openPicker}>Выбрать дату…</DropdownMenuItem>
          {task.deadline && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-muted-foreground" onClick={() => onDeadline(null)}>
                Убрать срок
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={dateRef}
        type="date"
        value={task.deadline ?? ''}
        onChange={(e) => e.target.value && onDeadline(e.target.value)}
        className="sr-only"
        tabIndex={-1}
        aria-label="Выбрать срок"
      />
    </>
  );
}
