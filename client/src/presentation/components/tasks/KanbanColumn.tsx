import { Fragment } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { AnimatePresence } from 'motion/react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Task, TaskStatus } from '@/domain/task/Task';
import { KanbanCard } from './KanbanCard';
import { DropIndicatorLine } from './DropIndicatorLine';
import { STATUS_SUBTITLE } from './statusLabels';

type Props = {
  status: TaskStatus;
  // Пустая строка ⇒ хедер без названия (backlog-колонка). Счётчик и `+` остаются.
  label: string;
  tasks: Task[];
  onCreate: (status: TaskStatus) => void;
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
  // Для DelegationBadge на карточках.
  currentUserId?: string | null;
  // Drop indicator: id перетаскиваемой карточки (null = нет активного drag'а).
  activeId?: string | null;
  // Drop target для этой колонки (null = курсор не над этой колонкой).
  dropTarget?: { status: TaskStatus; overId: string } | null;
};

export function KanbanColumn({
  status,
  label,
  tasks,
  onCreate,
  onEdit,
  onDelete,
  showShortId = true,
  onQuickPromote,
  onTaskChanged,
  headerExtra,
  showCheckbox = false,
  lastDoneTaskId = null,
  lastTodoTaskId = null,
  currentUserId = null,
  activeId = null,
  dropTarget = null,
}: Props): React.ReactElement {
  // Droppable нужен чтобы можно было кинуть карточку в ПУСТУЮ колонку —
  // SortableContext один не реагирует на drop в empty list.
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${status}`,
    data: { type: 'column', status },
  });

  return (
    <div className="flex w-[82vw] max-w-[20rem] shrink-0 snap-start flex-col rounded-lg border bg-muted/60 sm:w-72 sm:max-w-none sm:bg-muted/30">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {label.length > 0 && (
            <div className="min-w-0">
              <h3 className="truncate text-xs font-medium uppercase tracking-widest text-muted-foreground">
                {label}
              </h3>
              {STATUS_SUBTITLE[status] && (
                <p className="truncate text-[10px] leading-tight text-muted-foreground/60">
                  {STATUS_SUBTITLE[status]}
                </p>
              )}
            </div>
          )}
          <span className="shrink-0 rounded-full bg-background px-1.5 py-0.5 text-xs text-muted-foreground">
            {tasks.length}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          {headerExtra}
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={() => onCreate(status)}
            aria-label="Добавить задачу"
          >
            <Plus className="size-4" />
          </Button>
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={`flex min-h-[100px] flex-1 flex-col gap-2 p-2 transition-colors ${
          isOver ? 'bg-muted/60' : ''
        }`}
      >
        <SortableContext
          items={tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((t) => (
            <Fragment key={t.id}>
              <AnimatePresence>
                {dropTarget && dropTarget.overId === t.id && t.id !== activeId && (
                  <DropIndicatorLine key={`drop-before-${t.id}`} />
                )}
              </AnimatePresence>
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
                currentUserId={currentUserId}
              />
            </Fragment>
          ))}
        </SortableContext>
        {/* Индикатор в конце колонки: при drop в пустую зону или пустая колонка */}
        <AnimatePresence>
          {dropTarget && dropTarget.overId === `column-${status}` && (
            <DropIndicatorLine key={`drop-end-${status}`} />
          )}
        </AnimatePresence>
        {tasks.length === 0 && !dropTarget && (
          <p className="py-4 text-center text-xs text-muted-foreground/60">пусто</p>
        )}
      </div>
    </div>
  );
}
