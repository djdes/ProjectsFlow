import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
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
  GripVertical,
  ListFilter,
  MessageSquare,
  PanelRight,
  Plus,
  Snowflake,
  User,
  WrapText,
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
import { useContainer } from '@/infrastructure/di/container';
import { useTasks } from '@/presentation/hooks/useTasks';
import {
  NewPropertyMenuItems,
  PropertyHeaderCell,
  PropertyValueCell,
  useTaskProperties,
  type UseTaskPropertiesResult,
} from './customProperties';
import { useBulkTaskActions, type BulkResult } from '@/presentation/hooks/useBulkTaskActions';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { ProjectIconView } from '@/presentation/components/project/projectIconView';
import { STATUS_LABEL } from '../statusLabels';
import { DeadlineBadge } from '../DeadlineBadge';
import { DelegateTaskButton } from '../DelegateTaskButton';
import { type TaskDrawerState } from '../TaskDrawer';
import { ymd, startOfDay, addDays } from '../assignedGrouping';
import type { ViewCreateRequest } from './ProjectBoardViews';
import { SelectedBar } from './SelectedBar';
import { splitTitleBody } from '@/lib/taskTitleBody';
import {
  NewTaskRow,
  PRIORITY_PILL,
  STATUS_DOT,
  STATUS_PILL,
  VIEW_CALC_LABELS,
  VIEW_COLUMN_LABELS,
  ViewTaskDrawer,
  applyViewSort,
  buildTreeRows,
  groupKeyFor,
  groupLabelFor,
  hasActiveFilters,
  matchesFilters,
  rowColorFor,
  taskMenuEntries,
  taskTitle,
  type TreeRow,
  type TableViewState,
  type ViewCalc,
  type ViewColorRule,
  type ViewColumn,
  type ViewFilters,
  type ViewGrouping,
  type ViewSort,
  type ViewSortKey,
} from './viewShared';
import { ContextEntries, DropdownEntries, type MenuEntry } from './menuEntries';

type Props = {
  projectId: string;
  projectName?: string;
  memberCount?: number;
  filters: ViewFilters;
  onFiltersChange: (patch: Partial<ViewFilters>) => void;
  sort: ViewSort | null;
  onSortChange: (s: ViewSort | null) => void;
  hiddenCols: ViewColumn[];
  onToggleCol: (c: ViewColumn) => void;
  tableState: TableViewState;
  onTableState: (patch: Partial<TableViewState>) => void;
  grouping: ViewGrouping | null;
  colorRules: ViewColorRule[];
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
  onFiltersChange,
  sort,
  onSortChange,
  hiddenCols,
  onToggleCol,
  tableState,
  onTableState,
  grouping,
  colorRules,
  createRequest,
}: Props): React.ReactElement {
  const tasksApi = useTasks(projectId);
  const { tasks, loading, error, create, update, move, remove, refetch } = tasksApi;
  const { taskTemplateRepository } = useContainer();
  // Кастомные свойства (db/109): колонки после стандартных, «+» в шапке создаёт новое.
  const customProps = useTaskProperties(projectId);
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

  // Группировка (Notion Group by): порядок групп — по первому появлению в rows
  // (rows уже отсортированы по статусу/позиции или пользовательской сортировке).
  const groups = useMemo(() => {
    if (!grouping) return null;
    const map = new Map<string, Task[]>();
    for (const t of rows) {
      const key = groupKeyFor(t, grouping);
      const arr = map.get(key);
      if (arr) arr.push(t);
      else map.set(key, [t]);
    }
    return [...map.entries()].map(([key, tasks_]) => ({ key, tasks: tasks_ }));
  }, [rows, grouping]);
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const toggleGroup = (key: string): void =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const visibleCols = useMemo(
    () => ALL_COLUMNS.filter((c) => !hiddenCols.includes(c)),
    [hiddenCols],
  );

  // Подменю «Фильтр» в меню заголовка колонки (чекбоксы значений — как в Notion).
  const filterEntriesFor = (col: ViewColumn): MenuEntry[] | undefined => {
    if (col === 'status') {
      return VISIBLE_KANBAN_STATUSES.map((s) => ({
        kind: 'item' as const,
        label: STATUS_LABEL[s],
        dotClass: STATUS_DOT[s],
        checked: filters.statuses.includes(s),
        onSelect: () =>
          onFiltersChange({
            statuses: filters.statuses.includes(s)
              ? filters.statuses.filter((x) => x !== s)
              : [...filters.statuses, s],
          }),
      }));
    }
    if (col === 'priority') {
      return TASK_PRIORITIES.map((p) => ({
        kind: 'item' as const,
        label: PRIORITY_META[p].label,
        dotClass: PRIORITY_META[p].dotColor,
        checked: filters.priorities.includes(p),
        onSelect: () =>
          onFiltersChange({
            priorities: filters.priorities.includes(p)
              ? filters.priorities.filter((x) => x !== p)
              : [...filters.priorities, p],
          }),
      }));
    }
    if (col === 'deadline') {
      return (
        [
          ['has', 'Есть срок'],
          ['none', 'Без срока'],
          ['overdue', 'Просрочено'],
        ] as const
      ).map(([d, label]) => ({
        kind: 'item' as const,
        label,
        checked: filters.due === d,
        onSelect: () => onFiltersChange({ due: filters.due === d ? null : d }),
      }));
    }
    return undefined;
  };
  // Хвост-филлер справа (Notion): разделитель после последней колонки, границы строк
  // продолжаются до края. Ширины колонок — resize drag'ом за границу заголовка.
  const gridStyle = useMemo(
    () => ({
      gridTemplateColumns: [
        tableState.colWidths.title ? `${tableState.colWidths.title}px` : 'minmax(16rem,1fr)',
        ...visibleCols.map((c) =>
          tableState.colWidths[c] ? `${tableState.colWidths[c]}px` : COLUMN_WIDTH[c],
        ),
        ...customProps.properties.map(() => '180px'),
        'minmax(2rem,10rem)',
      ].join(' '),
    }),
    [visibleCols, tableState.colWidths, customProps.properties],
  );

  // Resize колонки (Notion): mousedown на правой кромке заголовка → drag.
  const startResize = (key: 'title' | ViewColumn, e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const cell = (e.currentTarget as HTMLElement).parentElement;
    if (!cell) return;
    const startX = e.clientX;
    const startW = cell.getBoundingClientRect().width;
    const onMove = (ev: MouseEvent): void => {
      const w = Math.round(Math.min(600, Math.max(96, startW + ev.clientX - startX)));
      onTableState({ colWidths: { ...tableState.colWidths, [key]: w } });
    };
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Inline-редактирование названия по клику в ячейку (Notion: клик = правка, открыть — OPEN).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const commitEdit = (task: Task): void => {
    const title = editValue.trim();
    setEditingId(null);
    if (!title || title === taskTitle(task)) return;
    const { body } = splitTitleBody(task.description ?? '');
    void update(task.id, { description: body ? `${title}\n${body}` : title }).catch((e: unknown) =>
      toast.error(`Не удалось: ${(e as Error).message}`),
    );
  };

  // «+» слева от строки (Notion): inline-строка ввода СРАЗУ ПОД текущей (Alt+клик — над).
  // asSub — создание ПОДЗАДАЧИ под якорем (db/107).
  const [insertAt, setInsertAt] = useState<{ taskId: string; above: boolean; asSub?: boolean } | null>(
    null,
  );
  const submitInsert = async (anchor: Task, above: boolean, title: string, asSub = false): Promise<void> => {
    const name = title.trim();
    if (!name) {
      setInsertAt(null);
      return;
    }
    try {
      if (asSub) {
        await create({
          description: name,
          status: anchor.status,
          parentTaskId: anchor.id,
          afterTaskId: anchor.id,
        });
        setExpandedTasks((prev) => new Set(prev).add(anchor.id));
      } else if (above) {
        const idx = rows.findIndex((t) => t.id === anchor.id);
        const prev = rows[idx - 1];
        const created = await create({ description: name, status: anchor.status });
        await move(created.id, {
          targetStatus: anchor.status,
          beforeTaskId: prev && prev.status === anchor.status ? prev.id : null,
          afterTaskId: anchor.id,
        });
      } else {
        await create({ description: name, status: anchor.status, afterTaskId: anchor.id });
      }
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
    }
    setInsertAt(null);
  };

  // Дерево подзадач (Notion sub-items): активен без группировки; свёрнуто по умолчанию.
  const [expandedTasks, setExpandedTasks] = useState<ReadonlySet<string>>(() => new Set());
  const toggleExpand = (id: string): void =>
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Drag «⋮⋮» — ручной порядок строк (Notion). Активен без пользовательской сортировки.
  const canReorder = sort === null;
  const [dragTask, setDragTask] = useState<Task | null>(null);

  // Только что перемещённая строка выделена синим, пока юзер не кликнет (как на канбане).
  const [recentlyMovedId, setRecentlyMovedId] = useState<string | null>(null);
  useEffect(() => {
    if (!recentlyMovedId) return;
    const clear = (): void => setRecentlyMovedId(null);
    const t = window.setTimeout(
      () => document.addEventListener('pointerdown', clear, { once: true }),
      0,
    );
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('pointerdown', clear);
    };
  }, [recentlyMovedId]);
  // PointerSensor (не Mouse!): мы гасим pointerdown preventDefault'ом против Radix-меню,
  // а это отменяет синтезированные mouse-события — MouseSensor не стартовал бы.
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const handleRowDragEnd = (e: DragEndEvent): void => {
    setDragTask(null);
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId || overId === activeId) return;
    const overIdx = rows.findIndex((t) => t.id === overId);
    if (overIdx < 0) return;
    const over = rows[overIdx]!;
    const prev = rows[overIdx - 1];
    if (prev?.id === activeId && prev.status === over.status) return; // уже на месте
    void move(activeId, {
      targetStatus: over.status,
      beforeTaskId: prev && prev.status === over.status ? prev.id : null,
      afterTaskId: over.id,
    })
      .then(() => setRecentlyMovedId(activeId))
      .catch((err: unknown) => toast.error(`Не удалось: ${(err as Error).message}`));
  };

  // Shift+клик по чекбоксу — выделение диапазона (Notion).
  const lastCheckedRef = useRef<number | null>(null);
  const toggleWithRange = (idx: number, shift: boolean): void => {
    const id = rows[idx]!.id;
    if (shift && lastCheckedRef.current !== null) {
      const [a, b] = [Math.min(lastCheckedRef.current, idx), Math.max(lastCheckedRef.current, idx)];
      setSelected((prevSel) => {
        const next = new Set(prevSel);
        for (let i = a; i <= b; i++) next.add(rows[i]!.id);
        return next;
      });
    } else {
      toggleSelected(id);
    }
    lastCheckedRef.current = idx;
  };

  // «Создать» из тулбара вью: открыть окно новой задачи в выбранной колонке.
  // С шаблоном (db/108) — задача создаётся сразу, без окна (Notion Templates).
  useEffect(() => {
    if (!createRequest) return;
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
      <DndContext
        sensors={dndSensors}
        collisionDetection={pointerWithin}
        onDragStart={(e) => setDragTask(rows.find((t) => t.id === String(e.active.id)) ?? null)}
        onDragEnd={handleRowDragEnd}
        onDragCancel={() => setDragTask(null)}
      >
      <div className="overflow-x-auto">
        {/* Левое «поле» (pl-12): hover-контролы строк живут в нём, как в Notion. */}
        <div className="min-w-[55rem] pl-12 pr-8">
          {/* Шапка таблицы: иконка типа свойства + название; клик по заголовку —
              меню колонки (сортировка ↑↓, скрыть свойство), как в Notion. */}
          <div
            className="group/head relative grid border-b border-t text-xs text-muted-foreground"
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
              extraEntries={[
                { kind: 'separator' },
                {
                  kind: 'item',
                  label: 'Переносить текст',
                  icon: WrapText,
                  checked: tableState.wrapTitle,
                  onSelect: () => onTableState({ wrapTitle: !tableState.wrapTitle }),
                },
                {
                  kind: 'item',
                  label: 'Закрепить колонку',
                  icon: Snowflake,
                  checked: tableState.freezeTitle,
                  onSelect: () => onTableState({ freezeTitle: !tableState.freezeTitle }),
                },
              ]}
              frozen={tableState.freezeTitle}
              onResizeStart={(e) => startResize('title', e)}
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
                filterEntries={filterEntriesFor(c)}
                onResizeStart={(e) => startResize(c, e)}
              />
            ))}
            {customProps.properties.map((p) => (
              <PropertyHeaderCell
                key={p.id}
                property={p}
                onRename={(name) => customProps.renameProperty(p.id, name)}
                onRemove={() => customProps.removeProperty(p.id)}
              />
            ))}
            <div className="border-l" aria-hidden />
            {/* «+» в конце шапки (Notion add property): вернуть скрытые свойства
                и создать новое кастомное свойство (db/109). */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Добавить свойство"
                  title="Добавить свойство"
                  className="absolute -right-7 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Plus className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[12rem]">
                {hiddenCols.length > 0 && (
                  <>
                    {hiddenCols.map((c) => (
                      <DropdownMenuItem key={c} className="gap-2" onClick={() => onToggleCol(c)}>
                        <ColumnIcon col={c} />
                        {VIEW_COLUMN_LABELS[c]}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                  </>
                )}
                <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                  Новое свойство
                </p>
                <NewPropertyMenuItems onCreate={customProps.createProperty} />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {(grouping && groups
            ? // При группировке дерево отключено — плоские строки внутри групп.
              (groups.flatMap((g) => {
                const sample = g.tasks[0];
                return [
                  <div
                    key={`__group-${g.key}`}
                    className="flex items-center gap-1.5 px-1 pb-1 pt-3"
                  >
                    <button
                      type="button"
                      aria-label={collapsedGroups.has(g.key) ? 'Развернуть группу' : 'Свернуть группу'}
                      onClick={() => toggleGroup(g.key)}
                      className="grid size-5 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <ChevronDown
                        className={cn('size-3.5 transition-transform', collapsedGroups.has(g.key) && '-rotate-90')}
                      />
                    </button>
                    <span className="text-sm font-medium">
                      {groupLabelFor(g.key, grouping, sample)}
                    </span>
                    <span className="text-xs text-muted-foreground">{g.tasks.length}</span>
                    {grouping !== 'assignee' && (
                      <button
                        type="button"
                        aria-label="Создать задачу в группе"
                        title="Создать задачу в группе"
                        onClick={() =>
                          setDrawer({
                            mode: 'create',
                            status: grouping === 'status' ? (g.key as Task['status']) : 'backlog',
                          })
                        }
                        className="grid size-5 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <Plus className="size-3.5" />
                      </button>
                    )}
                  </div>,
                  ...(collapsedGroups.has(g.key)
                    ? []
                    : g.tasks.map((t) => ({ task: t, depth: 0, hasChildren: false }))),
                ];
              }) as (React.ReactElement | TreeRow)[])
            : buildTreeRows(rows, expandedTasks)
          ).map((item) => {
            if (!(typeof item === 'object' && 'task' in item)) return item;
            const { task, depth, hasChildren } = item as TreeRow;
            const idx = rows.indexOf(task);
            return (
            <Fragment key={task.id}>
              {insertAt?.taskId === task.id && insertAt.above && !insertAt.asSub && (
                <InsertRow
                  gridStyle={gridStyle}
                  onSubmit={(title) => void submitInsert(task, true, title)}
                  onCancel={() => setInsertAt(null)}
                />
              )}
              <TableRow
                task={task}
                gridStyle={gridStyle}
                visibleCols={visibleCols}
                customProps={customProps}
                depth={depth}
                hasChildren={hasChildren}
                expanded={expandedTasks.has(task.id)}
                onToggleExpand={() => toggleExpand(task.id)}
                wrapTitle={tableState.wrapTitle}
                dndEnabled={canReorder}
                recentlyMoved={recentlyMovedId === task.id}
                rowColor={rowColorFor(task, colorRules)}
                frozenTitle={tableState.freezeTitle}
                editing={editingId === task.id}
                editValue={editValue}
                onEditValue={setEditValue}
                onStartEdit={() => {
                  setEditingId(task.id);
                  setEditValue(taskTitle(task));
                }}
                onCommitEdit={() => commitEdit(task)}
                onCancelEdit={() => setEditingId(null)}
                selected={selected.has(task.id)}
                anySelected={selected.size > 0}
                selCell={selCell}
                onSelCell={setSelCell}
                onToggleSelected={(shift) => toggleWithRange(idx, shift)}
                onOpen={() => setDrawer({ mode: 'edit', task })}
                onCreateBelow={(above) => setInsertAt({ taskId: task.id, above })}
                onAddSub={() => setInsertAt({ taskId: task.id, above: false, asSub: true })}
                onSaveTemplate={() =>
                  void taskTemplateRepository
                    .create(projectId, {
                      name: taskTitle(task).slice(0, 64),
                      description: task.description ?? '',
                      status: task.status,
                      priority: task.priority,
                      icon: task.icon,
                    })
                    .then(() => toast.success('Шаблон сохранён — доступен в меню «Создать ▾»'))
                    .catch((e: unknown) => toast.error(`Не удалось: ${(e as Error).message}`))
                }
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
                onStartDate={(d) =>
                  void update(task.id, { startDate: d }).catch((e: unknown) =>
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
              {insertAt?.taskId === task.id && !insertAt.above && (
                <InsertRow
                  gridStyle={gridStyle}
                  indent={insertAt.asSub ? (depth + 1) * 20 : depth * 20}
                  onSubmit={(title) => void submitInsert(task, false, title, insertAt.asSub)}
                  onCancel={() => setInsertAt(null)}
                />
              )}
            </Fragment>
            );
          })}

          {rows.length === 0 && (
            <p className="px-2 py-6 text-sm text-muted-foreground">
              {filters.query || hasActiveFilters(filters)
                ? 'Под фильтр ничего не попадает.'
                : 'Задач пока нет.'}
            </p>
          )}

          <div className="border-b py-1">
            <NewTaskRow create={create} />
          </div>
          {/* Строка подсчётов (Notion Calculate): «Всего» под названием; под каждой
              колонкой — свой подсчёт по клику (появляется при наведении). */}
          <div className="group/calc grid" style={gridStyle}>
            <p className="px-2 pt-1.5 text-[11px] text-muted-foreground/60">
              Всего: {rows.length}
            </p>
            {visibleCols.map((c) => (
              <CalcCell
                key={c}
                col={c}
                rows={rows}
                value={tableState.calc[c]}
                onChange={(v) =>
                  onTableState({ calc: { ...tableState.calc, [c]: v } })
                }
              />
            ))}
            {customProps.properties.map((p) => (
              <div key={p.id} aria-hidden />
            ))}
            <div aria-hidden />
          </div>
        </div>
      </div>

      {/* Призрак перетаскиваемой строки. */}
      <DragOverlay dropAnimation={null}>
        {dragTask ? (
          <div className="pointer-events-none max-w-[16rem] truncate rounded-md border bg-card px-2 py-1 text-sm font-medium shadow-lg ring-1 ring-primary/20">
            {taskTitle(dragTask)}
          </div>
        ) : null}
      </DragOverlay>
      </DndContext>

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

// Заголовок колонки: клик — меню (сортировка ↑↓, скрыть свойство). Стрелка в заголовке
// показывает активную сортировку по этой колонке.
function HeaderCell({
  label,
  iconNode,
  sortKey,
  sort,
  onSortChange,
  onHide,
  filterEntries,
  extraEntries,
  onResizeStart,
  first = false,
  frozen = false,
}: {
  label: string;
  iconNode: React.ReactNode;
  sortKey: ViewSortKey | null;
  sort: ViewSort | null;
  onSortChange: (s: ViewSort | null) => void;
  onHide?: () => void;
  filterEntries?: MenuEntry[];
  extraEntries?: MenuEntry[];
  onResizeStart?: (e: React.MouseEvent) => void;
  first?: boolean;
  frozen?: boolean;
}): React.ReactElement {
  const sorted = sortKey !== null && sort?.key === sortKey ? sort.dir : null;
  const entries: MenuEntry[] = [
    ...(filterEntries
      ? ([
          { kind: 'sub', label: 'Фильтр', icon: ListFilter, items: filterEntries },
          { kind: 'separator' },
        ] as MenuEntry[])
      : []),
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
    ...(extraEntries ?? []),
    ...(onHide
      ? ([
          ...(sortKey !== null ? ([{ kind: 'separator' }] as MenuEntry[]) : []),
          { kind: 'item', label: 'Скрыть в виде', icon: EyeOff, onSelect: onHide },
        ] as MenuEntry[])
      : []),
  ];
  return (
    <div
      className={cn(
        'relative flex min-w-0',
        !first && 'border-l',
        // «Закрепить колонку» (Notion Freeze): липнет при горизонтальном скролле.
        frozen && 'sticky left-0 z-20 border-r bg-background',
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left transition-colors hover:bg-accent/60"
          >
            {iconNode}
            <span className="truncate">{label}</span>
            {sorted === 'asc' && <ArrowUp className="size-3 shrink-0" />}
            {sorted === 'desc' && <ArrowDown className="size-3 shrink-0" />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[11rem]">
          <DropdownEntries entries={entries} />
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Ручка resize на правой кромке (Notion): drag меняет ширину колонки. */}
      {onResizeStart && (
        <div
          role="separator"
          aria-label={`Изменить ширину колонки ${label}`}
          onMouseDown={onResizeStart}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute -right-[3px] top-0 z-10 h-full w-[6px] cursor-col-resize rounded transition-colors hover:bg-primary/40"
        />
      )}
    </div>
  );
}

// Inline-строка вставки новой задачи над/под конкретной строкой (Notion «+»):
// Enter — создать, Esc/пустой blur — убрать.
function InsertRow({
  gridStyle,
  indent = 0,
  onSubmit,
  onCancel,
}: {
  gridStyle: React.CSSProperties;
  indent?: number;
  onSubmit: (title: string) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [value, setValue] = useState('');
  return (
    <div style={gridStyle} className="grid border-b bg-accent/30">
      <div
        className="flex items-center gap-1.5 px-2 py-1"
        style={indent > 0 ? { paddingLeft: 8 + indent } : undefined}
      >
        <FileText className="size-4 shrink-0 text-muted-foreground/40" />
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSubmit(value);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
          }}
          onBlur={() => (value.trim() ? onSubmit(value) : onCancel())}
          placeholder="Название задачи…"
          aria-label="Название новой задачи"
          className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground/50"
        />
      </div>
    </div>
  );
}

// Есть ли значение свойства у задачи (для подсчётов «Заполнено/Пусто»).
function hasValue(task: Task, col: ViewColumn): boolean {
  switch (col) {
    case 'status':
      return true;
    case 'priority':
      return task.priority !== null && task.priority !== undefined;
    case 'deadline':
      return Boolean(task.deadline);
    case 'assignee':
      return Boolean(task.delegation);
  }
}

// Ячейка подсчёта под колонкой (Notion Calculate): «Подсчёт ⌄» при наведении → меню;
// выбранный подсчёт показывается всегда.
function CalcCell({
  col,
  rows,
  value,
  onChange,
}: {
  col: ViewColumn;
  rows: readonly Task[];
  value: ViewCalc | undefined;
  onChange: (v: ViewCalc | undefined) => void;
}): React.ReactElement {
  const filled = rows.filter((t) => hasValue(t, col)).length;
  const text = (v: ViewCalc): string => {
    switch (v) {
      case 'count':
        return `Всего ${rows.length}`;
      case 'notEmpty':
        return `Заполнено ${filled}`;
      case 'empty':
        return `Пусто ${rows.length - filled}`;
      case 'pctNotEmpty':
        return rows.length === 0 ? '—' : `${Math.round((filled / rows.length) * 100)}%`;
    }
  };
  const entries: MenuEntry[] = [
    { kind: 'item', label: 'Нет', muted: true, onSelect: () => onChange(undefined) },
    ...(Object.keys(VIEW_CALC_LABELS) as ViewCalc[]).map((v) => ({
      kind: 'item' as const,
      label: VIEW_CALC_LABELS[v],
      checked: value === v,
      onSelect: () => onChange(v),
    })),
  ];
  return (
    <div className="flex justify-end border-l border-transparent px-1 pt-0.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-1 rounded px-1 text-[11px] transition-opacity hover:bg-accent',
              value
                ? 'text-muted-foreground'
                : 'text-muted-foreground/60 opacity-0 group-hover/calc:opacity-100',
            )}
          >
            {value ? text(value) : 'Подсчёт'}
            <ChevronDown className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[10rem]">
          <DropdownEntries entries={entries} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
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
  depth = 0,
  hasChildren = false,
  expanded = false,
  onToggleExpand,
  wrapTitle,
  dndEnabled,
  recentlyMoved,
  rowColor,
  frozenTitle,
  editing,
  editValue,
  onEditValue,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  selected,
  anySelected,
  selCell,
  onSelCell,
  onToggleSelected,
  onOpen,
  onCreateBelow,
  onAddSub,
  onSaveTemplate,
  onStatus,
  onPriority,
  onDeadline,
  onStartDate,
  onDuplicate,
  onDelete,
  currentUserId,
  projectId,
  onChanged,
  customProps,
}: {
  task: Task;
  gridStyle: React.CSSProperties;
  visibleCols: readonly ViewColumn[];
  depth?: number;
  hasChildren?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  wrapTitle: boolean;
  dndEnabled: boolean;
  recentlyMoved: boolean;
  rowColor: string | null;
  frozenTitle: boolean;
  editing: boolean;
  editValue: string;
  onEditValue: (v: string) => void;
  onStartEdit: () => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  selected: boolean;
  anySelected: boolean;
  selCell: string | null;
  onSelCell: (c: string | null) => void;
  onToggleSelected: (shift: boolean) => void;
  onOpen: () => void;
  onCreateBelow: (above: boolean) => void;
  onAddSub: () => void;
  onSaveTemplate: () => void;
  onStatus: (s: TaskStatus) => void;
  onPriority: (p: TaskPriority | null) => void;
  onDeadline: (d: string | null) => void;
  onStartDate: (d: string | null) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  currentUserId: string | null;
  projectId: string;
  onChanged: () => void;
  customProps: UseTaskPropertiesResult;
}): React.ReactElement {
  // Дроп-зона (вставка ПЕРЕД этой строкой — синяя линия сверху) + драг за «⋮⋮».
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: task.id, disabled: !dndEnabled });
  const {
    attributes: dragAttrs,
    listeners: dragListeners,
    setNodeRef: dragRef,
    isDragging,
  } = useDraggable({ id: task.id, disabled: !dndEnabled });
  const [gripMenuOpen, setGripMenuOpen] = useState(false);
  // Клик по «пустому» месту ячейки — выделение синей рамкой (Notion cell selection).
  const cellProps = (col: ViewColumn): { className: string; onMouseDown: (e: React.MouseEvent) => void } => ({
    className: cn(
      'relative border-l px-1 py-0.5',
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
                  className="flex h-full min-h-6 w-full items-center gap-1 rounded-md px-1 text-xs transition-colors hover:bg-accent"
                >
                  {/* Значение статуса — цветная пилюля (Notion select pill). */}
                  <span
                    className={cn(
                      'inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5',
                      STATUS_PILL[task.status],
                    )}
                  >
                    <span className={cn('size-2 shrink-0 rounded-full', STATUS_DOT[task.status])} />
                    <span className="truncate">{STATUS_LABEL[task.status]}</span>
                  </span>
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
                  className="flex h-full min-h-6 w-full items-center gap-1.5 rounded-md px-1 text-xs transition-colors hover:bg-accent"
                >
                  {task.priority !== null && task.priority !== undefined ? (
                    <span
                      className={cn(
                        'inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5',
                        PRIORITY_PILL[task.priority],
                      )}
                    >
                      <span
                        className={cn('size-2 shrink-0 rounded-full', PRIORITY_META[task.priority].dotColor)}
                      />
                      <span className="truncate">{PRIORITY_META[task.priority].label}</span>
                    </span>
                  ) : (
                    <span className="px-0.5 text-muted-foreground/60">—</span>
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
              className="h-full min-h-6 w-full justify-start px-1.5 text-xs"
            />
          </div>
        );
    }
  };

  const menuEntries = taskMenuEntries(task, projectId, {
    onOpen,
    onStatus,
    onPriority,
    onDeadline,
    onStartDate,
    onDuplicate,
    onDelete,
    onAddSub,
    onSaveTemplate,
  });

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={dropRef}
          style={gridStyle}
          className={cn(
            'group relative grid border-b transition-colors hover:bg-accent/40',
            // Условный цвет (Notion Conditional color) — до selected/moved подсветок.
            rowColor,
            selected && 'bg-primary/5',
            isDragging && 'opacity-40',
            // Синяя линия сверху — сюда вставится перетаскиваемая строка (Notion).
            isOver && 'shadow-[inset_0_2px_0_0_hsl(var(--primary))]',
            // Только что перемещена — синее выделение до клика в стороне (как на канбане).
            recentlyMoved && 'bg-primary/5 ring-2 ring-inset ring-primary/60',
          )}
        >
      {/* Hover-контролы в левом поле (Notion): «+» (вставить ниже, Alt — выше),
          «⋮⋮» (клик — меню, drag — перенос строки) и чекбокс (Shift — диапазон). */}
      <div
        className={cn(
          'absolute -left-14 top-1/2 flex -translate-y-1/2 items-center gap-0 transition-opacity duration-100',
          selected || anySelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
      >
        <button
          type="button"
          aria-label="Добавить задачу ниже (Alt — выше)"
          title="Добавить задачу ниже (Alt — выше)"
          onClick={(e) => onCreateBelow(e.altKey)}
          className="grid size-5 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
        <DropdownMenu open={gripMenuOpen} onOpenChange={setGripMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              ref={dragRef}
              {...dragAttrs}
              {...dragListeners}
              aria-label="Меню задачи (drag — перенос)"
              title="Меню задачи (drag — перенос)"
              onPointerDown={(e) => {
                // Гасим pointerdown-открытие Radix (иначе drag открывал бы меню);
                // dnd-kit слушает свой pointerdown из listeners выше.
                dragListeners?.onPointerDown?.(e);
                e.preventDefault();
              }}
              onClick={(e) => {
                if (e.defaultPrevented) return; // click после drag
                setGripMenuOpen(true);
              }}
              className="grid size-5 cursor-grab place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground active:cursor-grabbing"
            >
              <GripVertical className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[12rem]">
            <DropdownEntries entries={menuEntries} />
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => undefined}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelected(e.shiftKey);
          }}
          aria-label="Выбрать задачу"
          className="ml-0.5 size-3.5 cursor-pointer accent-primary"
        />
      </div>

      {/* Название: иконка + заголовок; клик по тексту — inline-правка (Notion: клик по
          ячейке редактирует, открытие — кнопкой «ОТКРЫТЬ»). Отступ и стрелка — дерево
          подзадач (Notion sub-items). */}
      <div
        className={cn(
          'flex min-w-0 items-center gap-1.5 px-2 py-1',
          frozenTitle && 'sticky left-0 z-10 border-r bg-background',
        )}
        style={depth > 0 ? { paddingLeft: 8 + depth * 20 } : undefined}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={expanded ? 'Свернуть подзадачи' : 'Развернуть подзадачи'}
            title={expanded ? 'Свернуть подзадачи' : 'Развернуть подзадачи'}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand?.();
            }}
            className="grid size-4 shrink-0 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
          >
            <ChevronDown
              className={cn('size-3.5 transition-transform', !expanded && '-rotate-90')}
            />
          </button>
        ) : (
          depth > 0 && <span className="size-4 shrink-0" aria-hidden />
        )}
        {task.icon ? (
          <span className="grid size-4 shrink-0 place-items-center overflow-hidden">
            <ProjectIconView icon={task.icon} pixelSize={15} className="text-sm" />
          </span>
        ) : (
          <FileText className="size-4 shrink-0 text-muted-foreground/60" />
        )}
        {editing ? (
          <input
            autoFocus
            value={editValue}
            onChange={(e) => onEditValue(e.target.value)}
            onBlur={onCommitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onCommitEdit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onCancelEdit();
              }
            }}
            aria-label="Название задачи"
            className="min-w-0 flex-1 rounded-md border bg-background px-1.5 py-0.5 text-sm font-medium outline-none ring-2 ring-primary/20"
          />
        ) : (
          <button
            type="button"
            onClick={onStartEdit}
            className={cn(
              'min-w-0 text-left text-sm font-medium',
              wrapTitle ? 'whitespace-normal break-words' : 'truncate',
            )}
          >
            {taskTitle(task)}
          </button>
        )}
        <button
          type="button"
          onClick={onOpen}
          className="ml-auto hidden shrink-0 items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground group-hover:inline-flex"
        >
          <PanelRight className="size-3" />
          Открыть
        </button>
        {/* Комментарий (Notion: hover-иконка Comment справа от названия) — открывает окно
            задачи, тред там. */}
        <button
          type="button"
          aria-label="Комментарий"
          title="Комментарий"
          onClick={onOpen}
          className="hidden shrink-0 rounded p-0.5 text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground group-hover:inline-flex"
        >
          <MessageSquare className="size-3.5" />
        </button>
      </div>

      {visibleCols.map(cellFor)}
      {customProps.properties.map((p) => (
        <PropertyValueCell
          key={p.id}
          property={p}
          value={customProps.valueFor(task.id, p.id)}
          onChange={(v) => customProps.setValue(task.id, p.id, v)}
          onAddOption={(label) => customProps.addOption(p, label)}
        />
      ))}
      <div className="border-l" aria-hidden />
        </div>
      </ContextMenuTrigger>
      {/* Правый клик по строке — контекстное меню задачи (Notion-style).
          onCloseAutoFocus preventDefault: возврат фокуса крал бы фокус у inline-инпутов
          (вставка подзадачи/переименование), открытых из пункта меню. */}
      <ContextMenuContent
        className="min-w-[12rem]"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <ContextEntries entries={menuEntries} />
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
            className="flex h-full min-h-6 w-full items-center gap-1.5 rounded-md px-1.5 text-xs transition-colors hover:bg-accent"
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
