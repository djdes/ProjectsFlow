import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  CircleDot,
  EyeOff,
  FileText,
  Flag,
  Maximize2,
  Plus,
  Trash2,
  User,
  X,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { Task, TaskPriority, TaskStatus } from '@/domain/task/Task';
import { TASK_PRIORITIES } from '@/domain/task/Task';
import { PRIORITY_META } from '@/domain/task/priorityMeta';
import { VISIBLE_KANBAN_STATUSES } from '@/domain/kanban/KanbanSettings';
import { useTasks } from '@/presentation/hooks/useTasks';
import { useBulkTaskActions, type BulkResult } from '@/presentation/hooks/useBulkTaskActions';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { ProjectIconView } from '@/presentation/components/project/projectIconView';
import { STATUS_LABEL } from '../statusLabels';
import { DeadlineBadge } from '../DeadlineBadge';
import { DelegateTaskButton } from '../DelegateTaskButton';
import { type TaskDrawerState } from '../TaskDrawer';
import { ymd, startOfDay, addDays } from '../assignedGrouping';
import type { ViewCreateRequest } from './ProjectBoardViews';
import {
  NewTaskRow,
  STATUS_DOT,
  VIEW_COLUMN_LABELS,
  ViewTaskDrawer,
  applyViewSort,
  matchesFilters,
  taskMenuEntries,
  taskTitle,
  type ViewColumn,
  type ViewFilters,
  type ViewSort,
  type ViewSortKey,
} from './viewShared';
import { ContextEntries, DropdownEntries, type MenuEntry } from './menuEntries';

type Props = {
  projectId: string;
  projectName?: string;
  memberCount?: number;
  filters: ViewFilters;
  sort: ViewSort | null;
  onSortChange: (s: ViewSort | null) => void;
  hiddenCols: ViewColumn[];
  onToggleCol: (c: ViewColumn) => void;
  createRequest: ViewCreateRequest | null;
};

// Ширины колонок; сетка собирается из видимых (скрытие свойств — как в Notion).
const COLUMN_WIDTH: Record<ViewColumn, string> = {
  status: '8.5rem',
  priority: '8rem',
  deadline: '8.5rem',
  assignee: '11rem',
};
const ALL_COLUMNS: readonly ViewColumn[] = ['status', 'priority', 'deadline', 'assignee'];

// Сортируемое свойство колонки (у «Ответственного» сортировки нет).
const COLUMN_SORT_KEY: Partial<Record<ViewColumn, ViewSortKey>> = {
  status: 'status',
  priority: 'priority',
  deadline: 'deadline',
};

// === Табличный вид доски (Notion-style) ===
// Notion-таблица: слева в «поле» строки при hover — чекбокс и «+»; в ячейке названия при
// hover — кнопка «Открыть»; клик по пустому месту ячейки выделяет её синей рамкой (Esc
// снимает); статус/приоритет/срок/ответственный редактируются прямо в ячейках; выбранные
// строки — плавающая панель действий сверху.
export function TableView({
  projectId,
  projectName,
  memberCount,
  filters,
  sort,
  onSortChange,
  hiddenCols,
  onToggleCol,
  createRequest,
}: Props): React.ReactElement {
  const tasksApi = useTasks(projectId);
  const { tasks, loading, error, create, update, move, remove, refetch } = tasksApi;
  const { user } = useCurrentUser();
  const isShared = (memberCount ?? 0) > 1;
  const [drawer, setDrawer] = useState<TaskDrawerState | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [selCell, setSelCell] = useState<string | null>(null); // `${taskId}:${col}`
  const bulk = useBulkTaskActions({ projectId, update, move, remove, refetch });

  const rows = useMemo(
    () => applyViewSort(tasks.filter((t) => matchesFilters(t, filters)), sort),
    [tasks, filters, sort],
  );

  const visibleCols = useMemo(
    () => ALL_COLUMNS.filter((c) => !hiddenCols.includes(c)),
    [hiddenCols],
  );
  const gridStyle = useMemo(
    () => ({
      gridTemplateColumns: ['minmax(0,1fr)', ...visibleCols.map((c) => COLUMN_WIDTH[c])].join(' '),
    }),
    [visibleCols],
  );

  // «Создать» из тулбара вью: открыть окно новой задачи в выбранной колонке.
  useEffect(() => {
    if (createRequest) setDrawer({ mode: 'create', status: createRequest.status });
  }, [createRequest]);

  // Esc снимает выделение ячейки.
  useEffect(() => {
    if (!selCell) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSelCell(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selCell]);

  const toggleSelected = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = rows.length > 0 && rows.every((t) => selected.has(t.id));
  const toggleAll = (): void => {
    setSelected(allSelected ? new Set() : new Set(rows.map((t) => t.id)));
  };

  const selectedIds = rows.filter((t) => selected.has(t.id)).map((t) => t.id);

  const reportBulk = (label: string) => (res: BulkResult) => {
    if (res.failed > 0) toast.error(`${label}: ${res.ok} из ${res.ok + res.failed}`);
    setSelected(new Set());
  };

  if (loading) return <div className="h-64 animate-pulse rounded-xl bg-muted/60" />;
  if (error) return <p className="text-sm text-destructive">{error}</p>;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="overflow-x-auto">
        {/* Левое «поле» (pl-12): hover-контролы строк живут в нём, как в Notion. */}
        <div className="min-w-[55rem] pl-12">
          {/* Шапка таблицы: иконка типа свойства + название; клик по заголовку —
              меню колонки (сортировка ↑↓, скрыть свойство), как в Notion. */}
          <div
            className="group/head relative grid border-b text-xs text-muted-foreground"
            style={gridStyle}
          >
            <div className="absolute -left-8 top-1/2 -translate-y-1/2">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                aria-label="Выбрать все"
                className={cn(
                  'size-3.5 cursor-pointer accent-primary transition-opacity',
                  allSelected || selected.size > 0 ? 'opacity-100' : 'opacity-0 group-hover/head:opacity-100',
                )}
              />
            </div>
            <HeaderCell
              label="Название"
              iconNode={
                <span className="font-mono text-[11px] leading-none text-muted-foreground/70">Aa</span>
              }
              sortKey="title"
              sort={sort}
              onSortChange={onSortChange}
              first
            />
            {visibleCols.map((c) => (
              <HeaderCell
                key={c}
                label={VIEW_COLUMN_LABELS[c]}
                iconNode={<ColumnIcon col={c} />}
                sortKey={COLUMN_SORT_KEY[c] ?? null}
                sort={sort}
                onSortChange={onSortChange}
                onHide={() => onToggleCol(c)}
              />
            ))}
          </div>

          {rows.map((task) => (
            <TableRow
              key={task.id}
              task={task}
              gridStyle={gridStyle}
              visibleCols={visibleCols}
              selected={selected.has(task.id)}
              anySelected={selected.size > 0}
              selCell={selCell}
              onSelCell={setSelCell}
              onToggleSelected={() => toggleSelected(task.id)}
              onOpen={() => setDrawer({ mode: 'edit', task })}
              onCreateBelow={() => setDrawer({ mode: 'create', status: task.status })}
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
              onDuplicate={() =>
                void create({
                  description: task.description ?? '',
                  status: task.status,
                  deadline: task.deadline ?? undefined,
                  priority: task.priority ?? undefined,
                }).catch((e: unknown) => toast.error(`Не удалось: ${(e as Error).message}`))
              }
              onDelete={() =>
                void remove(task.id)
                  .then(() => toast.success('Задача удалена'))
                  .catch((e: unknown) => toast.error(`Не удалось: ${(e as Error).message}`))
              }
              currentUserId={user?.id ?? null}
              projectId={projectId}
              onChanged={() => void refetch()}
            />
          ))}

          {rows.length === 0 && (
            <p className="px-2 py-6 text-sm text-muted-foreground">
              {filters.query || filters.status || filters.priority || filters.due
                ? 'Под фильтр ничего не попадает.'
                : 'Задач пока нет.'}
            </p>
          )}

          <div className="border-b py-1">
            <NewTaskRow create={create} />
          </div>
          <p className="px-2 pt-1.5 text-[11px] text-muted-foreground/60">Всего: {rows.length}</p>
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

      {/* Плавающая панель выбранных (Notion «N selected» сверху). */}
      {selectedIds.length > 0 && (
        <SelectedBar
          count={selectedIds.length}
          onExit={() => setSelected(new Set())}
          onStatus={(s) => void bulk.moveToColumn(selectedIds, s).then(reportBulk('Статус'))}
          onPriority={(p) => void bulk.setPriority(selectedIds, p).then(reportBulk('Приоритет'))}
          onDeadline={(d) => void bulk.setDeadline(selectedIds, d).then(reportBulk('Срок'))}
          onDelete={() => void bulk.remove(selectedIds).then(reportBulk('Удаление'))}
        />
      )}
    </div>
  );
}

// Плавающая панель действий над выбранными строками — копия Notion selection toolbar:
// «N выбрано ✕ | Статус | Приоритет | Срок | 🗑», плавает сверху по центру.
function SelectedBar({
  count,
  onExit,
  onStatus,
  onPriority,
  onDeadline,
  onDelete,
}: {
  count: number;
  onExit: () => void;
  onStatus: (s: TaskStatus) => void;
  onPriority: (p: TaskPriority | null) => void;
  onDeadline: (d: string | null) => void;
  onDelete: () => void;
}): React.ReactElement {
  const today = ymd(startOfDay(new Date()));
  return (
    <div
      role="toolbar"
      aria-label="Действия с выбранными задачами"
      className="fixed left-1/2 top-16 z-40 flex -translate-x-1/2 items-center overflow-hidden rounded-lg border bg-card shadow-lg duration-200 animate-in fade-in slide-in-from-top-2"
    >
      <span className="flex items-center gap-1.5 border-r px-2.5 py-1.5 text-xs font-medium text-primary">
        Выбрано: {count}
        <button type="button" aria-label="Снять выбор" onClick={onExit}>
          <X className="size-3.5 opacity-60 hover:opacity-100" />
        </button>
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="border-r px-2.5 py-1.5 text-xs transition-colors hover:bg-accent">
            Статус
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="min-w-[11rem]">
          {VISIBLE_KANBAN_STATUSES.map((s) => (
            <DropdownMenuItem key={s} className="gap-2" onClick={() => onStatus(s)}>
              <span className={cn('size-2 rounded-full', STATUS_DOT[s])} />
              {STATUS_LABEL[s]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="border-r px-2.5 py-1.5 text-xs transition-colors hover:bg-accent">
            Приоритет
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="min-w-[11rem]">
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="border-r px-2.5 py-1.5 text-xs transition-colors hover:bg-accent">
            Срок
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="min-w-[11rem]">
          <DropdownMenuItem onClick={() => onDeadline(today)}>Сегодня</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onDeadline(ymd(addDays(startOfDay(new Date()), 1)))}>
            Завтра
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-muted-foreground" onClick={() => onDeadline(null)}>
            Убрать срок
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        aria-label="Удалить выбранные"
        title="Удалить выбранные"
        onClick={onDelete}
        className="px-2.5 py-1.5 text-destructive transition-colors hover:bg-destructive/10"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

// Заголовок колонки: клик — меню (сортировка ↑↓, скрыть свойство). Стрелка в заголовке
// показывает активную сортировку по этой колонке.
function HeaderCell({
  label,
  iconNode,
  sortKey,
  sort,
  onSortChange,
  onHide,
  first = false,
}: {
  label: string;
  iconNode: React.ReactNode;
  sortKey: ViewSortKey | null;
  sort: ViewSort | null;
  onSortChange: (s: ViewSort | null) => void;
  onHide?: () => void;
  first?: boolean;
}): React.ReactElement {
  const sorted = sortKey !== null && sort?.key === sortKey ? sort.dir : null;
  const entries: MenuEntry[] = [
    ...(sortKey !== null
      ? ([
          {
            kind: 'item',
            label: 'По возрастанию',
            icon: ArrowUp,
            checked: sorted === 'asc',
            onSelect: () => onSortChange({ key: sortKey, dir: 'asc' }),
          },
          {
            kind: 'item',
            label: 'По убыванию',
            icon: ArrowDown,
            checked: sorted === 'desc',
            onSelect: () => onSortChange({ key: sortKey, dir: 'desc' }),
          },
          ...(sorted !== null
            ? ([
                {
                  kind: 'item',
                  label: 'Убрать сортировку',
                  muted: true,
                  onSelect: () => onSortChange(null),
                },
              ] as MenuEntry[])
            : []),
        ] as MenuEntry[])
      : []),
    ...(onHide
      ? ([
          ...(sortKey !== null ? ([{ kind: 'separator' }] as MenuEntry[]) : []),
          { kind: 'item', label: 'Скрыть в виде', icon: EyeOff, onSelect: onHide },
        ] as MenuEntry[])
      : []),
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center gap-1.5 px-2 py-1.5 text-left transition-colors hover:bg-accent/60',
            !first && 'border-l',
          )}
        >
          {iconNode}
          {label}
          {sorted === 'asc' && <ArrowUp className="size-3" />}
          {sorted === 'desc' && <ArrowDown className="size-3" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[11rem]">
        <DropdownEntries entries={entries} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ColumnIcon({ col }: { col: ViewColumn }): React.ReactElement {
  const cls = 'size-3.5 text-muted-foreground/70';
  switch (col) {
    case 'status':
      return <CircleDot className={cls} />;
    case 'priority':
      return <Flag className={cls} />;
    case 'deadline':
      return <CalendarDays className={cls} />;
    case 'assignee':
      return <User className={cls} />;
  }
}

function TableRow({
  task,
  gridStyle,
  visibleCols,
  selected,
  anySelected,
  selCell,
  onSelCell,
  onToggleSelected,
  onOpen,
  onCreateBelow,
  onStatus,
  onPriority,
  onDeadline,
  onDuplicate,
  onDelete,
  currentUserId,
  projectId,
  onChanged,
}: {
  task: Task;
  gridStyle: React.CSSProperties;
  visibleCols: readonly ViewColumn[];
  selected: boolean;
  anySelected: boolean;
  selCell: string | null;
  onSelCell: (c: string | null) => void;
  onToggleSelected: () => void;
  onOpen: () => void;
  onCreateBelow: () => void;
  onStatus: (s: TaskStatus) => void;
  onPriority: (p: TaskPriority | null) => void;
  onDeadline: (d: string | null) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  currentUserId: string | null;
  projectId: string;
  onChanged: () => void;
}): React.ReactElement {
  // Клик по «пустому» месту ячейки — выделение синей рамкой (Notion cell selection).
  const cellProps = (col: ViewColumn): { className: string; onMouseDown: (e: React.MouseEvent) => void } => ({
    className: cn(
      'relative border-l px-1 py-1',
      selCell === `${task.id}:${col}` &&
        'ring-2 ring-inset ring-primary/70 after:pointer-events-none after:absolute after:-bottom-[3px] after:-right-[3px] after:size-1.5 after:rounded-[1px] after:bg-primary',
    ),
    onMouseDown: (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('button,input,a')) return;
      onSelCell(`${task.id}:${col}`);
    },
  });

  const cellFor = (col: ViewColumn): React.ReactElement => {
    switch (col) {
      case 'status':
        return (
          <div key={col} {...cellProps('status')}>
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
        );
      case 'priority':
        return (
          <div key={col} {...cellProps('priority')}>
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
        );
      case 'deadline':
        return (
          <div key={col} {...cellProps('deadline')}>
            <DeadlineCell task={task} onDeadline={onDeadline} />
          </div>
        );
      case 'assignee':
        return (
          <div key={col} {...cellProps('assignee')}>
            <DelegateTaskButton
              task={task}
              currentUserId={currentUserId}
              onChanged={onChanged}
              projectId={projectId}
              className="h-6 max-w-full justify-start px-1.5 text-xs"
            />
          </div>
        );
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          style={gridStyle}
          className={cn(
            'group relative grid border-b transition-colors hover:bg-accent/40',
            selected && 'bg-primary/5',
          )}
        >
      {/* Hover-контролы в левом поле: «+» (новая задача в той же колонке) и чекбокс. */}
      <div
        className={cn(
          'absolute -left-12 top-1/2 flex -translate-y-1/2 items-center gap-0.5 transition-opacity',
          selected || anySelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
      >
        <button
          type="button"
          aria-label="Новая задача"
          title="Новая задача"
          onClick={onCreateBelow}
          className="grid size-5 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelected}
          onClick={(e) => e.stopPropagation()}
          aria-label="Выбрать задачу"
          className="size-3.5 cursor-pointer accent-primary"
        />
      </div>

      {/* Название: иконка + заголовок + hover-кнопка «Открыть» (Notion OPEN). */}
      <div className="flex min-w-0 items-center gap-1.5 px-2 py-1.5">
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
          className="min-w-0 truncate text-left text-sm font-medium decoration-muted-foreground/40 underline-offset-2 hover:underline"
        >
          {taskTitle(task)}
        </button>
        <button
          type="button"
          onClick={onOpen}
          className="ml-auto hidden shrink-0 items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground group-hover:inline-flex"
        >
          <Maximize2 className="size-3" />
          Открыть
        </button>
      </div>

      {visibleCols.map(cellFor)}
        </div>
      </ContextMenuTrigger>
      {/* Правый клик по строке — контекстное меню задачи (Notion-style). */}
      <ContextMenuContent className="min-w-[12rem]">
        <ContextEntries
          entries={taskMenuEntries(task, {
            onOpen,
            onStatus,
            onPriority,
            onDeadline,
            onDuplicate,
            onDelete,
          })}
        />
      </ContextMenuContent>
    </ContextMenu>
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
