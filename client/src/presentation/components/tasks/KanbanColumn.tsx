import { Fragment, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { AnimatePresence } from 'motion/react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { RalphMode, Task, TaskPriority, TaskStatus } from '@/domain/task/Task';
import { cn } from '@/lib/utils';
import { KanbanCard } from './KanbanCard';
import { DropIndicatorLine } from './DropIndicatorLine';
import { TaskComposer } from './TaskComposer';
import { STATUS_SUBTITLE } from './statusLabels';
import type { SelectModifiers } from './selection/selectionReducer';

export type KanbanColumnColorClasses = {
  readonly pill: string;
  readonly body: string;
};

type InlineCreateInput = {
  description: string;
  status?: TaskStatus;
  ralphMode?: RalphMode;
  delegateUserId?: string | null;
  deadline?: string | null;
  priority?: TaskPriority | null;
};

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
  // taskId'ы с активной LIVE-сессией воркера — карточка рисует 🔴 точку.
  liveTaskIds?: ReadonlySet<string>;
  // Цвета колонки (пилюля заголовка + мягкая тонировка тела). Notion-стиль.
  colorClasses?: KanbanColumnColorClasses;
  // Меню колонки (троеточие): переименование / цвет / скрытие. Рендерится в шапке.
  columnMenu?: React.ReactNode;
  // Если задан — под колонкой появляется кнопка «Добавить задачу», раскрывающая
  // inline-композер (со всем функционалом быстрого создания). Создаёт задачу в этой колонке.
  onInlineCreate?: (input: InlineCreateInput) => Promise<Task>;
  // Прокидывается в inline-композер (делегирование + AI-кнопка).
  isInbox?: boolean;
  isShared?: boolean;
  aiProjectId?: string | null;
  // Уникальный ключ черновика для inline-композера этой колонки.
  composerStorageKey?: string;
  // === Режим мультивыделения (включается из меню колонки) ===
  // Активен ли режим выделения для ЭТОЙ колонки.
  selectionMode?: boolean;
  // Множество выбранных id (глобальное, но в режиме содержит только id этой колонки).
  selectedIds?: ReadonlySet<string>;
  onSelectToggle?: (taskId: string, mods: SelectModifiers) => void;
  onSelectAll?: () => void;
  onSelectNone?: () => void;
  onExitSelection?: () => void;
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
  liveTaskIds,
  colorClasses,
  columnMenu,
  onInlineCreate,
  isInbox = false,
  isShared = false,
  aiProjectId = null,
  composerStorageKey,
  selectionMode = false,
  selectedIds,
  onSelectToggle,
  onSelectAll,
  onSelectNone,
  onExitSelection,
}: Props): React.ReactElement {
  // Droppable нужен чтобы можно было кинуть карточку в ПУСТУЮ колонку —
  // SortableContext один не реагирует на drop в empty list.
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${status}`,
    data: { type: 'column', status },
  });
  const [composing, setComposing] = useState(false);

  return (
    <div
      className={cn(
        'flex h-full min-h-0 w-[82vw] max-w-[20rem] shrink-0 snap-start flex-col rounded-lg border sm:w-72 sm:max-w-none',
        colorClasses?.body ?? 'bg-muted/60 sm:bg-muted/30',
      )}
    >
      <div
        className={cn(
          'flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2',
          // Режим выделения: подсвечиваем шапку акцентом, чтобы было видно активную колонку.
          selectionMode && 'bg-primary/10',
        )}
      >
        {selectionMode ? (
          <>
            <span className="min-w-0 truncate text-xs font-medium">
              Выбрано {selectedIds?.size ?? 0}
            </span>
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={onSelectAll}
              >
                Все
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={onSelectNone}
              >
                Никого
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={onExitSelection}
                aria-label="Выйти из режима выделения"
                title="Выйти (Esc)"
              >
                <X className="size-4" />
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex min-w-0 items-center gap-2">
              {label.length > 0 && (
                <div className="min-w-0">
                  <span
                    className={cn(
                      'inline-block max-w-full truncate rounded px-1.5 py-0.5 text-xs font-medium uppercase tracking-widest',
                      colorClasses?.pill ?? 'text-muted-foreground',
                    )}
                  >
                    {label}
                  </span>
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
              {columnMenu}
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
          </>
        )}
      </div>

      <div
        ref={setNodeRef}
        className={`flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 transition-colors ${
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
                liveRunning={liveTaskIds?.has(t.id) ?? false}
                selectionMode={selectionMode}
                selected={selectedIds?.has(t.id) ?? false}
                onSelectToggle={onSelectToggle}
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

      {onInlineCreate && (
        <div className="shrink-0 border-t p-2">
          {composing ? (
            <TaskComposer
              variant="inline"
              forcedStatus={status}
              autoFocus
              onClose={() => setComposing(false)}
              onCreate={onInlineCreate}
              isInbox={isInbox}
              isShared={isShared}
              aiProjectId={aiProjectId}
              storageKey={composerStorageKey}
            />
          ) : (
            <button
              type="button"
              onClick={() => setComposing(true)}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Plus className="size-4" />
              Создать задачу
            </button>
          )}
        </div>
      )}
    </div>
  );
}
