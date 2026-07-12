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
import { ChevronDown, FileText, GripVertical, Pencil, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { splitTitleBody } from '@/lib/taskTitleBody';
import { cn } from '@/lib/utils';
import type { Task } from '@/domain/task/Task';
import { TASK_PRIORITIES } from '@/domain/task/Task';
import { PRIORITY_META } from '@/domain/task/priorityMeta';
import { useContainer } from '@/infrastructure/di/container';
import { useTasks } from '@/presentation/hooks/useTasks';
import { useBulkTaskActions, type BulkResult } from '@/presentation/hooks/useBulkTaskActions';
import { ProjectIconView } from '@/presentation/components/project/projectIconView';
import { UserAvatar } from '@/presentation/components/user/UserAvatar';
import { STATUS_LABEL } from '../statusLabels';
import { DeadlineBadge } from '../DeadlineBadge';
import { type TaskDrawerState } from '../TaskDrawer';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { toast } from '@/components/ui/sonner';
import type { ViewCreateRequest } from './ProjectBoardViews';
import { SelectedBar } from './SelectedBar';
import {
  NewTaskRow,
  STATUS_DOT,
  STATUS_PILL,
  ViewTaskDrawer,
  applyViewSort,
  buildTreeRows,
  groupKeyFor,
  type StandardGrouping,
  groupLabelFor,
  hasActiveFilters,
  matchesFilters,
  rowColorFor,
  taskMenuEntries,
  isUntitledTask,
  taskTitle,
  type TreeRow,
  type ViewColorRule,
  type ViewFilters,
  type ViewGrouping,
  type ViewSort,
} from './viewShared';
import { ContextEntries, DropdownEntries, type MenuEntry } from './menuEntries';

type Props = {
  projectId: string;
  projectName?: string;
  memberCount?: number;
  filters: ViewFilters;
  sort: ViewSort | null;
  grouping: ViewGrouping | null;
  colorRules: ViewColorRule[];
  createRequest: ViewCreateRequest | null;
};

// === Списочный вид доски (Notion-style) ===
// Плоский список: hover-контролы («+», «⋮⋮» — клик-меню/drag-перенос, чекбокс) в левом
// поле строки, название (карандаш — правка на месте), справа тихие свойства.
// Клик — окно задачи; выбранные — панель действий сверху.
export function ListView({
  projectId,
  projectName,
  memberCount,
  filters,
  sort,
  grouping,
  colorRules,
  createRequest,
}: Props): React.ReactElement {
  const tasksApi = useTasks(projectId);
  const { tasks, loading, error, create, update, move, remove, refetch } = tasksApi;
  const { taskTemplateRepository } = useContainer();
  const isShared = (memberCount ?? 0) > 1;
  const [drawer, setDrawer] = useState<TaskDrawerState | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const bulk = useBulkTaskActions({ projectId, update, move, remove, refetch });

  const rows = useMemo(
    () => applyViewSort(tasks.filter((t) => matchesFilters(t, filters)), sort),
    [tasks, filters, sort],
  );

  // Группировка (Notion Group by): порядок групп — по первому появлению в rows.
  // `p:<id>`-группировка (по кастомному свойству) живёт только в таблице — у списка
  // нет значений свойств, рендерим без групп.
  const groups = useMemo(() => {
    if (!grouping || grouping.startsWith('p:')) return null;
    const map = new Map<string, Task[]>();
    for (const t of rows) {
      const key = groupKeyFor(t, grouping as StandardGrouping);
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

  // «Создать» из тулбара; с шаблоном (db/108) — задача создаётся сразу, без окна.
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

  const toggleSelected = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // «+» слева (Notion): inline-строка ввода сразу под текущей; asSub — подзадача.
  // Enter коммитит и открывает ввод следующей ниже (цепочка, как в канбане).
  const [insertAfterId, setInsertAfterId] = useState<string | null>(null);
  const [insertAsSub, setInsertAsSub] = useState(false);
  const [insertParentId, setInsertParentId] = useState<string | null>(null);
  const [insertValue, setInsertValue] = useState('');
  const submitInsert = async (anchor: Task): Promise<void> => {
    const name = insertValue.trim();
    const asSub = insertAsSub;
    setInsertValue('');
    if (!name) {
      setInsertAfterId(null);
      setInsertAsSub(false);
      setInsertParentId(null);
      return;
    }
    try {
      const parentId = asSub ? (insertParentId ?? anchor.id) : null;
      const created = await create({
        description: name,
        status: anchor.status,
        afterTaskId: anchor.id,
        ...(parentId ? { parentTaskId: parentId } : {}),
      });
      if (parentId) {
        setExpandedTasks((prev) => new Set(prev).add(parentId));
        setInsertParentId(parentId);
      }
      // Цепочка: следующий ввод — под только что созданной строкой.
      setInsertAfterId(created.id);
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
      setInsertAfterId(null);
      setInsertAsSub(false);
      setInsertParentId(null);
    }
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

  // Inline-переименование (карандаш при hover — Notion list): меняем title-часть описания.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const startEdit = (task: Task): void => {
    setEditingId(task.id);
    setEditValue(taskTitle(task));
  };
  const commitEdit = (task: Task): void => {
    const title = editValue.trim();
    setEditingId(null);
    if (!title || title === taskTitle(task)) return;
    const { body } = splitTitleBody(task.description ?? '');
    void update(task.id, { description: body ? `${title}\n${body}` : title }).catch((e: unknown) =>
      toast.error(`Не удалось: ${(e as Error).message}`),
    );
  };

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
      onAddSub: () => {
        setInsertAfterId(task.id);
        setInsertAsSub(true);
        setInsertValue('');
      },
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

  // Drag «⋮⋮» — ручной порядок (Notion), активен без пользовательской сортировки.
  const canReorder = sort === null;
  const [dragTask, setDragTask] = useState<Task | null>(null);
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

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

  const handleRowDragEnd = (e: DragEndEvent): void => {
    setDragTask(null);
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId || overId === activeId) return;
    const overIdx = rows.findIndex((t) => t.id === overId);
    if (overIdx < 0) return;
    const over = rows[overIdx]!;
    const prev = rows[overIdx - 1];
    if (prev?.id === activeId && prev.status === over.status) return;
    void move(activeId, {
      targetStatus: over.status,
      beforeTaskId: prev && prev.status === over.status ? prev.id : null,
      afterTaskId: over.id,
    })
      .then(() => setRecentlyMovedId(activeId))
      .catch((err: unknown) => toast.error(`Не удалось: ${(err as Error).message}`));
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
      <div className="flex flex-col pl-12">
        {(grouping && groups
          ? (groups.flatMap((g) => {
              const sample = g.tasks[0];
              return [
                <div key={`__group-${g.key}`} className="flex items-center gap-1.5 px-1 pb-1 pt-3">
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
                    {groupLabelFor(g.key, grouping as StandardGrouping, sample)}
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
          return (
          <Fragment key={task.id}>
            <ListRow
              task={task}
              depth={depth}
              hasChildren={hasChildren}
              expanded={expandedTasks.has(task.id)}
              onToggleExpand={() => toggleExpand(task.id)}
              dndEnabled={canReorder}
              recentlyMoved={recentlyMovedId === task.id}
              rowColor={rowColorFor(task, colorRules)}
              selected={selected.has(task.id)}
              anySelected={selected.size > 0}
              editing={editingId === task.id}
              editValue={editValue}
              onEditValue={setEditValue}
              onStartEdit={() => startEdit(task)}
              onCommitEdit={() => commitEdit(task)}
              onCancelEdit={() => setEditingId(null)}
              onToggleSelected={() => toggleSelected(task.id)}
              onOpen={() => setDrawer({ mode: 'edit', task })}
              onInsertBelow={() => {
                setInsertAfterId(task.id);
                setInsertValue('');
              }}
              menu={menuFor(task)}
            />
            {insertAfterId === task.id && (
              <div className="flex items-center gap-1.5 rounded-md bg-accent/30 px-2 py-1.5">
                <FileText className="size-4 shrink-0 text-muted-foreground/40" />
                <input
                  autoFocus
                  value={insertValue}
                  onChange={(e) => setInsertValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void submitInsert(task);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setInsertAfterId(null);
                    }
                  }}
                  onBlur={() => void submitInsert(task)}
                  placeholder="Название задачи…"
                  aria-label="Название новой задачи"
                  className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground/50"
                />
              </div>
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

        <div className="py-1">
          <NewTaskRow create={create} />
        </div>
        <p className="px-2 pt-1 text-[11px] text-muted-foreground/60">Всего: {rows.length}</p>
      </div>

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

      {/* Панель действий над выбранными — СВЕРХУ, как в Notion (общая с таблицей). */}
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

// Строка списка: droppable (вставка ПЕРЕД — синяя линия сверху) + drag за «⋮⋮».
function ListRow({
  task,
  depth = 0,
  hasChildren = false,
  expanded = false,
  onToggleExpand,
  dndEnabled,
  recentlyMoved,
  rowColor,
  selected,
  anySelected,
  editing,
  editValue,
  onEditValue,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onToggleSelected,
  onOpen,
  onInsertBelow,
  menu,
}: {
  task: Task;
  depth?: number;
  hasChildren?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  dndEnabled: boolean;
  recentlyMoved: boolean;
  rowColor: string | null;
  selected: boolean;
  anySelected: boolean;
  editing: boolean;
  editValue: string;
  onEditValue: (v: string) => void;
  onStartEdit: () => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onToggleSelected: () => void;
  onOpen: () => void;
  onInsertBelow: () => void;
  menu: MenuEntry[];
}): React.ReactElement {
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: task.id, disabled: !dndEnabled });
  const {
    attributes: dragAttrs,
    listeners: dragListeners,
    setNodeRef: dragRef,
    isDragging,
  } = useDraggable({ id: task.id, disabled: !dndEnabled });
  const [gripMenuOpen, setGripMenuOpen] = useState(false);
  // Клик, «отпущенный» сразу после drag'а строки, не должен открывать задачу.
  const wasDragged = useRef(false);
  useEffect(() => {
    if (isDragging) wasDragged.current = true;
  }, [isDragging]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          // Notion: строку списка можно тащить за ЛЮБОЕ место (не только за «⋮⋮») —
          // drag стартует после сдвига на 6px (PointerSensor distance), клик остаётся
          // кликом. Интерактивные элементы внутри строки drag не начинают.
          ref={(el) => {
            dropRef(el);
            dragRef(el);
          }}
          onPointerDown={(e) => {
            const t = e.target as HTMLElement;
            if (t.closest('button, input, a, [contenteditable="true"]')) return;
            dragListeners?.onPointerDown?.(e as unknown as React.PointerEvent);
          }}
          className={cn(
            // Notion list: компактная строка ровно 30px.
            'group relative flex min-h-[30px] cursor-pointer items-center gap-1.5 rounded-md px-2 py-0.5 transition-colors hover:bg-accent/50',
            rowColor,
            selected && 'bg-primary/5',
            isDragging && 'opacity-40',
            isOver && 'shadow-[inset_0_2px_0_0_hsl(var(--primary))]',
            recentlyMoved && 'bg-primary/5 ring-2 ring-inset ring-primary/60',
          )}
          style={depth > 0 ? { paddingLeft: 8 + depth * 20 } : undefined}
          onClick={() => {
            if (wasDragged.current) {
              wasDragged.current = false;
              return;
            }
            onOpen();
          }}
        >
          {/* Стрелка раскрытия подзадач (Notion sub-items). */}
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
              <ChevronDown className={cn('size-3.5 transition-transform', !expanded && '-rotate-90')} />
            </button>
          ) : (
            depth > 0 && <span className="size-4 shrink-0" aria-hidden />
          )}
          {/* Hover-контролы в левом поле (Notion): «+», «⋮⋮» (клик-меню/drag) и чекбокс. */}
          <div
            className={cn(
              'absolute -left-14 top-1/2 flex -translate-y-1/2 items-center gap-0 transition-opacity duration-100',
              anySelected || selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label="Добавить задачу ниже"
              title="Добавить задачу ниже"
              onClick={onInsertBelow}
              className="grid size-5 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
            >
              <Plus className="size-3.5" />
            </button>
            <DropdownMenu open={gripMenuOpen} onOpenChange={setGripMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  {...dragAttrs}
                  {...dragListeners}
                  aria-label="Меню задачи (drag — перенос)"
                  title="Меню задачи (drag — перенос)"
                  onPointerDown={(e) => {
                    dragListeners?.onPointerDown?.(e);
                    e.preventDefault();
                  }}
                  onClick={(e) => {
                    if (e.defaultPrevented) return;
                    setGripMenuOpen(true);
                  }}
                  className="grid size-5 cursor-grab place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground active:cursor-grabbing"
                >
                  <GripVertical className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[12rem]">
                <DropdownEntries entries={menu} />
              </DropdownMenuContent>
            </DropdownMenu>
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelected}
              aria-label="Выбрать задачу"
              className="ml-0.5 size-3.5 cursor-pointer accent-primary"
            />
          </div>
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
              onClick={(e) => e.stopPropagation()}
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
            <>
              <span
                className={cn(
                  'min-w-0 truncate text-sm font-medium',
                  task.status === 'done' &&
                    'text-muted-foreground line-through decoration-muted-foreground/40',
                  // Notion: безымянная страница — серый плейсхолдер.
                  isUntitledTask(task) && 'font-normal text-muted-foreground/60',
                )}
              >
                {taskTitle(task)}
              </span>
              {/* Карандаш при hover — переименовать прямо в списке (Notion). */}
              <button
                type="button"
                aria-label="Переименовать"
                title="Переименовать"
                onClick={(e) => {
                  e.stopPropagation();
                  onStartEdit();
                }}
                className="grid size-5 shrink-0 place-items-center rounded border bg-card text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground group-hover:opacity-100"
              >
                <Pencil className="size-3" />
              </button>
              <span className="min-w-0 flex-1" />
            </>
          )}
          {/* Тихие свойства справа: срок / приоритет / статус / ответственный. */}
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            {task.deadline && <DeadlineBadge deadline={task.deadline} status={task.status} />}
            {task.priority !== null &&
              task.priority !== undefined &&
              TASK_PRIORITIES.includes(task.priority) && (
                <span className="flex items-center gap-1 whitespace-nowrap">
                  <span className={cn('size-2 rounded-full', PRIORITY_META[task.priority].dotColor)} />
                  {PRIORITY_META[task.priority].label}
                </span>
              )}
            <span
              className={cn(
                'flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5',
                STATUS_PILL[task.status],
              )}
            >
              <span className={cn('size-1.5 rounded-full', STATUS_DOT[task.status])} />
              {STATUS_LABEL[task.status]}
            </span>
            {task.delegation && (
              <UserAvatar
                displayName={task.delegation.delegateDisplayName}
                avatarUrl={task.delegation.delegateAvatarUrl}
                className="size-5 text-[9px]"
              />
            )}
          </span>
        </div>
      </ContextMenuTrigger>
      {/* Правый клик по строке — контекстное меню задачи (Notion-style).
          onCloseAutoFocus preventDefault: не красть фокус у inline-инпутов. */}
      <ContextMenuContent
        className="min-w-[12rem]"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <ContextEntries entries={menu} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
