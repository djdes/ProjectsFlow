import { useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
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

// === Списочный вид доски (Notion-style, план board-views-design) ===
// Плоский вертикальный список: иконка + название, справа тихие чипы (статус/приоритет/
// срок/ответственный). Клик — окно задачи; чекбоксы — BulkActionBar.
export function ListView({ projectId, projectName, memberCount }: Props): React.ReactElement {
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

      <div className="flex flex-col">
        {rows.map((task) => (
          <div
            key={task.id}
            className={cn(
              'group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/50',
              selected.has(task.id) && 'bg-primary/5',
            )}
            onClick={() => setDrawer({ mode: 'edit', task })}
          >
            <input
              type="checkbox"
              checked={selected.has(task.id)}
              onChange={() => toggleSelected(task.id)}
              onClick={(e) => e.stopPropagation()}
              aria-label="Выбрать задачу"
              className={cn(
                'size-3.5 shrink-0 cursor-pointer accent-primary transition-opacity',
                selected.has(task.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
              )}
            />
            {task.icon ? (
              <span className="grid size-4 shrink-0 place-items-center overflow-hidden">
                <ProjectIconView icon={task.icon} pixelSize={15} className="text-sm" />
              </span>
            ) : (
              <FileText className="size-4 shrink-0 text-muted-foreground/60" />
            )}
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-sm',
                task.status === 'done' && 'text-muted-foreground line-through decoration-muted-foreground/40',
              )}
            >
              {taskTitle(task)}
            </span>
            {/* Тихие чипы справа: срок / приоритет / статус / ответственный. */}
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
        ))}

        {rows.length === 0 && (
          <p className="px-2 py-6 text-sm text-muted-foreground">
            {query ? 'Под фильтр ничего не попадает.' : 'Задач пока нет.'}
          </p>
        )}

        <div className="py-1">
          <NewTaskRow create={create} />
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
