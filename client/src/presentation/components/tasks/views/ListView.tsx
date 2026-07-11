import { Fragment, useEffect, useMemo, useState } from 'react';
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
import { FileText, GripVertical, Pencil, Plus } from 'lucide-react';
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
  hasActiveFilters,
  matchesFilters,
  taskMenuEntries,
  taskTitle,
  type ViewFilters,
  type ViewSort,
} from './viewShared';
import { ContextEntries, DropdownEntries, type MenuEntry } from './menuEntries';

type Props = {
  projectId: string;
  projectName?: string;
  memberCount?: number;
  filters: ViewFilters;
  sort: ViewSort | null;
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
  createRequest,
}: Props): React.ReactElement {
  const tasksApi = useTasks(projectId);
  const { tasks, loading, error, create, update, move, remove, refetch } = tasksApi;
  const isShared = (memberCount ?? 0) > 1;
  const [drawer, setDrawer] = useState<TaskDrawerState | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const bulk = useBulkTaskActions({ projectId, update, move, remove, refetch });

  const rows = useMemo(
    () => applyViewSort(tasks.filter((t) => matchesFilters(t, filters)), sort),
    [tasks, filters, sort],
  );

  useEffect(() => {
    if (createRequest) setDrawer({ mode: 'create', status: createRequest.status });
  }, [createRequest]);

  const toggleSelected = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // «+» слева (Notion): inline-строка ввода сразу под текущей.
  const [insertAfterId, setInsertAfterId] = useState<string | null>(null);
  const [insertValue, setInsertValue] = useState('');
  const submitInsert = async (anchor: Task): Promise<void> => {
    const name = insertValue.trim();
    setInsertAfterId(null);
    setInsertValue('');
    if (!name) return;
    try {
      await create({ description: name, status: anchor.status, afterTaskId: anchor.id });
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
    }
  };

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
      onDuplicate: () =>
        void create({
          description: task.description ?? '',
          status: task.status,
          deadline: task.deadline ?? undefined,
          priority: task.priority ?? undefined,
        }).catch((e: unknown) => toast.error(`Не удалось: ${(e as Error).message}`)),
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
        {rows.map((task) => (
          <Fragment key={task.id}>
            <ListRow
              task={task}
              dndEnabled={canReorder}
              recentlyMoved={recentlyMovedId === task.id}
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
        ))}

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
  dndEnabled,
  recentlyMoved,
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
  dndEnabled: boolean;
  recentlyMoved: boolean;
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

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={dropRef}
          className={cn(
            'group relative flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/50',
            selected && 'bg-primary/5',
            isDragging && 'opacity-40',
            isOver && 'shadow-[inset_0_2px_0_0_hsl(var(--primary))]',
            recentlyMoved && 'bg-primary/5 ring-2 ring-inset ring-primary/60',
          )}
          onClick={onOpen}
        >
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
                  ref={dragRef}
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
      {/* Правый клик по строке — контекстное меню задачи (Notion-style). */}
      <ContextMenuContent className="min-w-[12rem]">
        <ContextEntries entries={menu} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
