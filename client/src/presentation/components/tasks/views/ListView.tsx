import { useEffect, useMemo, useState } from 'react';
import { FileText, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TASK_PRIORITIES } from '@/domain/task/Task';
import { VISIBLE_KANBAN_STATUSES } from '@/domain/kanban/KanbanSettings';
import { PRIORITY_META } from '@/domain/task/priorityMeta';
import { useTasks } from '@/presentation/hooks/useTasks';
import { useBulkTaskActions } from '@/presentation/hooks/useBulkTaskActions';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { ProjectIconView } from '@/presentation/components/project/projectIconView';
import { UserAvatar } from '@/presentation/components/user/UserAvatar';
import { STATUS_LABEL } from '../statusLabels';
import { DeadlineBadge } from '../DeadlineBadge';
import { BulkActionBar } from '../BulkActionBar';
import { type TaskDrawerState } from '../TaskDrawer';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { toast } from '@/components/ui/sonner';
import type { ViewCreateRequest } from './ProjectBoardViews';
import {
  NewTaskRow,
  STATUS_DOT,
  ViewTaskDrawer,
  applyViewSort,
  matchesFilters,
  taskMenuEntries,
  taskTitle,
  type ViewFilters,
  type ViewSort,
} from './viewShared';
import { ContextEntries } from './menuEntries';

type Props = {
  projectId: string;
  projectName?: string;
  memberCount?: number;
  filters: ViewFilters;
  sort: ViewSort | null;
  createRequest: ViewCreateRequest | null;
};

// === Списочный вид доски (Notion-style) ===
// Плоский список: hover-контролы («+» и чекбокс) в левом поле строки, название, справа
// тихие свойства (срок/приоритет/статус/ответственный). Клик — окно задачи.
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
  const { user } = useCurrentUser();
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

  if (loading) return <div className="h-64 animate-pulse rounded-xl bg-muted/60" />;
  if (error) return <p className="text-sm text-destructive">{error}</p>;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col pl-12">
        {rows.map((task) => (
          <ContextMenu key={task.id}>
            <ContextMenuTrigger asChild>
          <div
            className={cn(
              'group relative flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/50',
              selected.has(task.id) && 'bg-primary/5',
            )}
            onClick={() => setDrawer({ mode: 'edit', task })}
          >
            {/* Hover-контролы в левом поле (Notion): «+» и чекбокс. */}
            <div
              className={cn(
                'absolute -left-12 top-1/2 flex -translate-y-1/2 items-center gap-0.5 transition-opacity',
                selected.size > 0 || selected.has(task.id)
                  ? 'opacity-100'
                  : 'opacity-0 group-hover:opacity-100',
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                aria-label="Новая задача"
                title="Новая задача"
                onClick={() => setDrawer({ mode: 'create', status: task.status })}
                className="grid size-5 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
              >
                <Plus className="size-3.5" />
              </button>
              <input
                type="checkbox"
                checked={selected.has(task.id)}
                onChange={() => toggleSelected(task.id)}
                aria-label="Выбрать задачу"
                className="size-3.5 cursor-pointer accent-primary"
              />
            </div>
            {task.icon ? (
              <span className="grid size-4 shrink-0 place-items-center overflow-hidden">
                <ProjectIconView icon={task.icon} pixelSize={15} className="text-sm" />
              </span>
            ) : (
              <FileText className="size-4 shrink-0 text-muted-foreground/60" />
            )}
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-sm font-medium',
                task.status === 'done' && 'text-muted-foreground line-through decoration-muted-foreground/40',
              )}
            >
              {taskTitle(task)}
            </span>
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
              <span className="flex items-center gap-1 whitespace-nowrap rounded-full bg-muted px-1.5 py-0.5">
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
              <ContextEntries
                entries={taskMenuEntries(task, {
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
                })}
              />
            </ContextMenuContent>
          </ContextMenu>
        ))}

        {rows.length === 0 && (
          <p className="px-2 py-6 text-sm text-muted-foreground">
            {filters.query || filters.status || filters.priority || filters.due
              ? 'Под фильтр ничего не попадает.'
              : 'Задач пока нет.'}
          </p>
        )}

        <div className="py-1">
          <NewTaskRow create={create} />
        </div>
        <p className="px-2 pt-1 text-[11px] text-muted-foreground/60">Всего: {rows.length}</p>
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
