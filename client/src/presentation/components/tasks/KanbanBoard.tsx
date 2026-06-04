import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  defaultDropAnimationSideEffects,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
} from '@dnd-kit/core';
import { motion } from 'motion/react';
import { ArrowDownNarrowWide, ArrowUpNarrowWide } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import type { Task, TaskStatus } from '@/domain/task/Task';
import { TASK_STATUSES } from '@/domain/task/Task';
import { useTasks } from '@/presentation/hooks/useTasks';
import { useBulkTaskActions } from '@/presentation/hooks/useBulkTaskActions';
import { useDoneSortOrder, type DoneSortOrder } from '@/presentation/hooks/useDoneSortOrder';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { LIVE_CHANGED_EVENT } from '@/presentation/hooks/useNotificationStream';
import { KanbanCard } from './KanbanCard';
import { KanbanColumn } from './KanbanColumn';
import { KanbanColumnMenu } from './KanbanColumnMenu';
import { BulkActionBar } from './BulkActionBar';
import {
  nextAnchor,
  nextSelection,
  selectAll,
  selectNone,
  type SelectModifiers,
} from './selection/selectionReducer';
import { KanbanHiddenColumnsMenu } from './KanbanHiddenColumnsMenu';
import { KANBAN_COLOR_CLASSES } from './kanbanColors';
import { QuickAddTodo } from './QuickAddTodo';
import { STATUS_LABEL } from './statusLabels';
import { TaskDrawer, type TaskDrawerState } from './TaskDrawer';
import { useKanbanSettings } from '@/presentation/hooks/useKanbanSettings';
import {
  VISIBLE_KANBAN_STATUSES,
  isColumnHidden,
  resolveColumnColor,
  resolveColumnLabel,
  type VisibleKanbanStatus,
} from '@/domain/kanban/KanbanSettings';

type Props = {
  projectId: string;
  // Если false — TaskDrawer не показывает секцию коммитов. Для inbox-проекта так:
  // у него нет git-репо, привязывать нечего.
  showCommits?: boolean;
  // Имя проекта — пробрасывается в TaskDrawer как контекстный заголовок. В inbox не передаём.
  projectName?: string;
  // Скрыть выполненные (status='done'). Toggle на странице InboxPage.
  hideDone?: boolean;
  // Количество участников проекта. > 1 ⇒ совместный — показываем блок делегирования.
  memberCount?: number;
};

// Какие колонки реально рисуем. in_progress и awaiting_clarification не имеют
// собственных колонок — задачи в этих статусах визуально живут в TODO с badge'ом
// статуса справа снизу. См. KanbanCard. 'manual' — собственная колонка между
// backlog и todo: парковка для задач, которые делает человек руками.
const VISIBLE_STATUSES: readonly TaskStatus[] = ['backlog', 'manual', 'todo', 'done'];

// Маппинг реального статуса в визуальную колонку.
function toVisibleStatus(status: TaskStatus): TaskStatus {
  if (status === 'in_progress' || status === 'awaiting_clarification') return 'todo';
  return status;
}

// Длительность drop-анимации в ms. Используется и dnd-kit'ом для position-lerp'а оверлея,
// и motion'ом для exit-анимации rotate/scale у обёртки preview — они должны быть равны.
const DROP_DURATION_MS = 320;
const DROP_EASING_BEZIER = [0.32, 0.72, 0, 1] as const; // Apple smooth-spring, без длинного хвоста

// Drop-анимация: «приземление» карточки в новый слот.
// opacity у active === стартовое значение source-card (см. KanbanCard: isDragging → opacity-30),
// затем side-effect плавно возвращает к 1.
const DROP_ANIMATION: DropAnimation = {
  duration: DROP_DURATION_MS,
  easing: `cubic-bezier(${DROP_EASING_BEZIER.join(', ')})`,
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: { opacity: '0.3' },
    },
  }),
};

// Always-measuring: dnd-kit перемеряет контейнеры при каждом drag-кадре, не только при
// стартe. Это убирает рывки когда карточки в reflow меняют свои размеры/позиции.
const MEASURING_CONFIG = {
  droppable: { strategy: MeasuringStrategy.Always },
};

function groupByStatus(tasks: Task[], doneOrder: DoneSortOrder): Record<TaskStatus, Task[]> {
  // Группируем по визуальной колонке: in_progress / awaiting_clarification визуально
  // лежат в TODO (статус на task'е сохраняется и отображается badge'ом справа снизу).
  const out: Record<TaskStatus, Task[]> = {
    backlog: [],
    manual: [],
    todo: [],
    in_progress: [],
    awaiting_clarification: [],
    done: [],
  };
  for (const t of tasks) out[toVisibleStatus(t.status)].push(t);
  for (const s of TASK_STATUSES) {
    if (s === 'done') {
      // Готовые сортируем по времени завершения (updatedAt), а не по position:
      // перенос в done обновляет updatedAt, поэтому свежевыполненная задача сама
      // встаёт наверх при 'newest'. Это развязывает порядок done с position и не
      // конфликтует с drag-математикой (она привязана к position в остальных колонках).
      const dir = doneOrder === 'newest' ? -1 : 1;
      out[s].sort((a, b) => dir * (a.updatedAt.getTime() - b.updatedAt.getTime()));
    } else {
      out[s].sort((a, b) => a.position - b.position);
    }
  }
  return out;
}

export function KanbanBoard({ projectId, showCommits = true, projectName, hideDone = false, memberCount }: Props): React.ReactElement {
  const { tasks, loading, error, create, update, move, remove, refetch } = useTasks(projectId);
  const { user } = useCurrentUser();
  // isInbox = это inbox-board (задаётся через showCommits=false — у inbox нет git-репо).
  // Чекбокс «выполнено» показываем на ВСЕХ досках (inbox и проекты): клик → done,
  // снятие → restore прежней колонки (status_before_done). Сервер сам гейтит право
  // (move_task=editor): viewer получит 403 + revert, как и при drag'е.
  const isInbox = !showCommits;
  const isShared = !isInbox && (memberCount ?? 0) > 1;
  // Общие (на проект) настройки доски: цвета/переименования/скрытие колонок + глобальные
  // дефолтные цвета юзера. Резолв цвета/подписи делаем на лету при рендере колонок.
  const { settings, defaults, setColor, setLabel, setHidden } = useKanbanSettings(projectId);
  const [dialog, setDialog] = useState<TaskDrawerState | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  // Deep-link из email-кнопки: ?task=<id> открывает диалог задачи (один раз после загрузки).
  const deepLinkedRef = useRef(false);
  useEffect(() => {
    if (deepLinkedRef.current || loading) return;
    const taskId = searchParams.get('task');
    if (!taskId) return;
    deepLinkedRef.current = true;
    const task = tasks.find((t) => t.id === taskId);
    // Ловим #comment-<id> из hash ДО очистки query (setSearchParams сбрасывает hash).
    const hashMatch = /^#comment-(.+)$/.exec(window.location.hash);
    const scrollToCommentId = hashMatch ? hashMatch[1] : undefined;
    // ?done=1 — «✓ Готово»-ссылка из дайджеста: переносим задачу в «Готово».
    // С подтверждением: защита от случайного клика и префетча почтовых сканеров
    // (действие идёт в уже авторизованной сессии, право write_project гейтит сервер).
    if (task && searchParams.get('done') === '1') {
      if (window.confirm('Перенести задачу в «Готово»?')) {
        void move(task.id, { targetStatus: 'done', beforeTaskId: null, afterTaskId: null })
          .then(() => toast.success('Задача перенесена в «Готово»'))
          .catch((err) => toast.error(`Не удалось: ${(err as Error).message}`));
      }
    } else if (task) {
      setDialog({ mode: 'edit', task, scrollToCommentId });
    }
    // Чистим query, чтобы повторное открытие/refetch не дёргали диалог/перенос.
    const next = new URLSearchParams(searchParams);
    next.delete('task');
    next.delete('done');
    setSearchParams(next, { replace: true });
  }, [loading, tasks, searchParams, setSearchParams, move]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Множество taskId с активной (running) LIVE-сессией — для 🔴 точки на карточке.
  // Обновляется по realtime-событию 'pf:live-changed' (debounce 100мс коалесцирует пачку).
  const [liveTaskIds, setLiveTaskIds] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Накапливаем дельты и применяем разом (debounce), чтобы пачка start/finish не дёргала рендер.
    const pending = new Map<string, boolean>();
    const flush = (): void => {
      timer = null;
      if (pending.size === 0) return;
      setLiveTaskIds((prev) => {
        const next = new Set(prev);
        for (const [taskId, running] of pending) {
          if (running) next.add(taskId);
          else next.delete(taskId);
        }
        pending.clear();
        return next;
      });
    };
    const onLive = (e: Event): void => {
      const detail = (e as CustomEvent<{ projectId?: string; taskId?: string; status?: string }>)
        .detail;
      if (detail?.projectId !== projectId || !detail.taskId) return;
      pending.set(detail.taskId, detail.status === 'running');
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 100);
    };
    window.addEventListener(LIVE_CHANGED_EVENT, onLive);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(LIVE_CHANGED_EVENT, onLive);
    };
  }, [projectId]);
  // Позиция drop-индикатора: в какой колонке и над каким элементом находится курсор.
  // overId — id задачи (вставка перед ней) или 'column-{status}' (вставка в конец).
  const [dropTarget, setDropTarget] = useState<{
    status: TaskStatus;
    overId: string;
  } | null>(null);
  // 'lifted' — карточка приподнята (rotate+scale), 'settled' — лерпит обратно к identity.
  // Меняем на 'settled' в момент drop'а и держим activeId до конца drop-анимации, чтобы
  // motion успел синхронно с position-lerp'ом dnd-kit'а распрямить наклон.
  const [previewPhase, setPreviewPhase] = useState<'lifted' | 'settled'>('settled');
  const dropTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Чувствительность: 5px минимум до старта drag — иначе одиночный клик ловится как drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const { order: doneOrder, toggle: toggleDoneOrder } = useDoneSortOrder();
  const grouped = useMemo(() => groupByStatus(tasks, doneOrder), [tasks, doneOrder]);
  const activeTask = activeId ? tasks.find((t) => t.id === activeId) ?? null : null;

  // === Мультивыделение (scoped к одной колонке) ===
  // selectionStatus — колонка в режиме выделения (null = режим выключен).
  const [selectionStatus, setSelectionStatus] = useState<VisibleKanbanStatus | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const anchorRef = useRef<string | null>(null); // якорь для Shift-диапазона
  const bulk = useBulkTaskActions({ projectId, update, move, remove, refetch });
  // Визуальный порядок карточек активной колонки — для диапазона и «выделить всё».
  // Должен совпадать с тем, что реально отрисовано: при hideDone done-колонка пуста.
  const selectionOrderedIds =
    selectionStatus && !(hideDone && selectionStatus === 'done')
      ? grouped[selectionStatus].map((t) => t.id)
      : [];

  const enterSelection = (status: VisibleKanbanStatus): void => {
    setSelectionStatus(status);
    setSelectedIds(new Set());
    anchorRef.current = null;
  };
  const exitSelection = useCallback((): void => {
    setSelectionStatus(null);
    setSelectedIds(new Set());
    anchorRef.current = null;
  }, []);
  const handleSelectToggle = (taskId: string, mods: SelectModifiers): void => {
    // Валидируем якорь: после bulk-операций / внешних (SSE) изменений он мог указывать
    // на исчезнувшую карточку — тогда трактуем как «нет якоря» и начинаем диапазон
    // заново от кликнутой (иначе Shift молча деградировал бы в одиночный тогл навсегда).
    const anchor =
      anchorRef.current && selectionOrderedIds.includes(anchorRef.current)
        ? anchorRef.current
        : null;
    setSelectedIds((prev) => nextSelection(prev, taskId, mods, selectionOrderedIds, anchor));
    anchorRef.current = nextAnchor(taskId, mods, anchor);
  };
  const handleSelectAll = (): void => {
    setSelectedIds(selectAll(selectionOrderedIds));
    anchorRef.current = null;
  };
  const handleSelectNone = (): void => {
    setSelectedIds(selectNone());
    anchorRef.current = null;
  };

  // Esc выходит из режима выделения (слушаем только пока режим активен).
  // defaultPrevented пропускаем: открытый Radix-дропдаун/диалог уже обработал Esc
  // (закрылся) и вызвал preventDefault — не хотим заодно гасить весь режим.
  useEffect(() => {
    if (selectionStatus === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) exitSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectionStatus, exitSelection]);

  // hideDone скрывает done-колонку целиком — выходим из выделения, чтобы не оставлять
  // «подвисший» режим (счётчик и кнопки) на пустой невидимой колонке.
  useEffect(() => {
    if (hideDone && selectionStatus === 'done') exitSelection();
  }, [hideDone, selectionStatus, exitSelection]);
  // Последняя задача в backlog/todo — нужна footer-композеру в TaskDrawer'е для
  // beforeTaskId при move'е через переключатель «В черновики / Воркеру».
  const backlogTail = grouped.backlog[grouped.backlog.length - 1] ?? null;
  const todoTail = grouped.todo[grouped.todo.length - 1] ?? null;
  // Inbox-чекбокс: при ткании «done» кладём в конец done-колонки; «un-done» — в конец todo.
  // doneOrder влияет на отображение (newest сверху/снизу), но «последний по position»
  // — это для расчёта позиции на сервере; используем хвост по position среди done.
  const doneByPos = useMemo(() => [...tasks.filter((t) => t.status === 'done')].sort((a, b) => a.position - b.position), [tasks]);
  const lastDoneTaskId = doneByPos[doneByPos.length - 1]?.id ?? null;
  const lastTodoTaskId = todoTail?.id ?? null;

  const handleDragStart = (e: DragStartEvent): void => {
    // Если drop-таймер ещё висит от предыдущего перетаскивания — гасим, иначе он позже
    // обнулит activeId уже нового drag'а.
    if (dropTimerRef.current) {
      clearTimeout(dropTimerRef.current);
      dropTimerRef.current = null;
    }
    setActiveId(String(e.active.id));
    setDropTarget(null);
    setPreviewPhase('lifted');
  };

  const handleDragOver = (e: DragOverEvent): void => {
    const { active, over } = e;
    if (!over || !active) {
      setDropTarget(null);
      return;
    }

    const overData = over.data.current as
      | { type?: 'task' | 'column'; status?: TaskStatus }
      | undefined;

    if (overData?.type === 'column' && overData.status) {
      setDropTarget({ status: overData.status, overId: `column-${overData.status}` });
    } else if (overData?.type === 'task') {
      const overTask = tasks.find((t) => t.id === over.id);
      if (!overTask) {
        setDropTarget(null);
        return;
      }
      setDropTarget({
        status: toVisibleStatus(overTask.status),
        overId: String(over.id),
      });
    } else {
      setDropTarget(null);
    }
  };

  const handleDragEnd = async (e: DragEndEvent): Promise<void> => {
    // 1) motion начинает лерпить rotate/scale обратно к identity.
    setPreviewPhase('settled');
    setDropTarget(null);
    // 2) activeId держим живым ровно до конца drop-анимации — DragOverlay в это время
    //    рендерит motion.div, и тот успевает доехать до rotate:0.
    dropTimerRef.current = setTimeout(() => {
      setActiveId(null);
      dropTimerRef.current = null;
    }, DROP_DURATION_MS);
    const { active, over } = e;
    if (!over) return;

    const activeTask = tasks.find((t) => t.id === active.id);
    if (!activeTask) return;

    // Определяем целевой статус: либо это column drop zone, либо карточка из колонки.
    const overData = over.data.current as { type?: 'task' | 'column'; status?: TaskStatus } | undefined;
    let targetStatus: TaskStatus;
    if (overData?.type === 'column' && overData.status) {
      targetStatus = overData.status;
    } else {
      const overTask = tasks.find((t) => t.id === over.id);
      if (!overTask) return;
      // Visible-нормализация: если дропнули над in_progress/awaiting_clarification
      // карточкой (визуально лежит в TODO), целевая колонка — todo.
      targetStatus = toVisibleStatus(overTask.status);
    }

    // Если активная задача in_progress / awaiting_clarification дропается в TODO
    // (где она и так живёт визуально), её реальный статус сохраняем — это просто
    // реордер внутри визуальной колонки, а не возврат к todo.
    if (
      targetStatus === 'todo' &&
      (activeTask.status === 'in_progress' || activeTask.status === 'awaiting_clarification')
    ) {
      targetStatus = activeTask.status;
    }

    // Список карточек в визуальной колонке БЕЗ перетаскиваемой (для расчёта соседей).
    // Берём именно визуальную колонку, потому что in_progress / awaiting_clarification
    // карточки физически живут в grouped['todo'] (см. groupByStatus).
    const visibleColumn = toVisibleStatus(targetStatus);
    const targetList = grouped[visibleColumn].filter((t) => t.id !== activeTask.id);

    let insertIndex: number;
    if (overData?.type === 'column') {
      // Кинули в пустое место колонки — в конец.
      insertIndex = targetList.length;
    } else {
      insertIndex = targetList.findIndex((t) => t.id === over.id);
      if (insertIndex === -1) insertIndex = targetList.length;
    }

    const beforeTask = insertIndex > 0 ? targetList[insertIndex - 1] : null;
    const afterTask = insertIndex < targetList.length ? targetList[insertIndex] : null;

    // No-op: дропнули туда же, где было.
    if (toVisibleStatus(activeTask.status) === visibleColumn) {
      const currentList = grouped[visibleColumn];
      const currentIndex = currentList.findIndex((t) => t.id === activeTask.id);
      if (currentIndex === insertIndex || currentIndex === insertIndex - 1) return;
    }

    try {
      await move(activeTask.id, {
        targetStatus,
        beforeTaskId: beforeTask?.id ?? null,
        afterTaskId: afterTask?.id ?? null,
      });
    } catch (err) {
      toast.error(`Не удалось переместить: ${(err as Error).message}`);
    }
  };

  const handleDialogSubmit = async (input: {
    description: string;
    ralphMode?: import('@/domain/task/Task').RalphMode;
    delegateUserId?: string | null;
    deadline?: string | null;
    priority?: import('@/domain/task/Task').TaskPriority | null;
  }): Promise<Task> => {
    if (!dialog) throw new Error('Dialog state missing');
    if (dialog.mode === 'create') {
      return create({ ...input, status: dialog.status });
    }
    // edit-mode: TaskRepository.update не принимает delegateUserId — он только
    // для create. Deadline/priority меняются через TaskPriorityChip/TaskDeadlineChip
    // в шапке drawer'а (отдельные PATCH).
    return update(dialog.task.id, { description: input.description, ralphMode: input.ralphMode });
  };

  const handleQuickPromote = async (task: Task): Promise<void> => {
    // Кидаем в самый верх TODO: beforeTaskId=null + afterTaskId=первая карточка
    // (или null если TODO пуст). Server'ный MoveTask посчитает position сам.
    const todoFirst = grouped.todo[0] ?? null;
    try {
      await move(task.id, {
        targetStatus: 'todo',
        beforeTaskId: null,
        afterTaskId: todoFirst?.id ?? null,
      });
    } catch (err) {
      toast.error(`Не удалось перенести: ${(err as Error).message}`);
    }
  };

  const handleDelete = async (task: Task): Promise<void> => {
    // Превью первой строки описания — чтобы было понятно что именно удаляешь.
    const preview = (task.description ?? '').split('\n')[0]?.slice(0, 60) ?? '';
    const label = preview.length > 0 ? `"${preview}${preview.length === 60 ? '…' : ''}"` : 'задачу';
    if (!window.confirm(`Удалить ${label}?`)) return;
    try {
      await remove(task.id);
      toast.success('Задача удалена');
    } catch (err) {
      toast.error(`Не удалось удалить: ${(err as Error).message}`);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-24 animate-pulse rounded-lg bg-muted" />
        <div className="flex gap-4 overflow-x-auto">
          {VISIBLE_STATUSES.map((s) => (
            <div
              key={s}
              className="h-64 w-[82vw] max-w-[20rem] shrink-0 animate-pulse rounded-lg bg-muted/60 sm:w-72 sm:max-w-none sm:bg-muted"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  // Скрытые колонки исключаем из рендера (задачи скрытых статусов остаются в `grouped`,
  // поэтому drag-математика в handleDragEnd не ломается). Скрытые перечисляем в меню доски.
  const shownStatuses = VISIBLE_KANBAN_STATUSES.filter((s) => !isColumnHidden(settings?.[s]));
  const hiddenColumns = VISIBLE_KANBAN_STATUSES.filter((s) => isColumnHidden(settings?.[s])).map(
    (s) => ({ status: s, label: resolveColumnLabel(settings?.[s], STATUS_LABEL[s]) }),
  );

  return (
    // Доска занимает оставшуюся высоту экрана (родитель страницы — flex h-full flex-col),
    // колонки скроллятся внутри себя (Todoist-стиль). pb на ряду — резерв под floating-композер.
    <div className="flex min-h-0 flex-1 flex-col">
      <DndContext
        sensors={sensors}
        measuring={MEASURING_CONFIG}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setDropTarget(null);
          setPreviewPhase('settled');
          setActiveId(null);
        }}
      >
        {/* На мобиле колонки занимают почти всю ширину и «прилипают» при свайпе
            (snap), на десктопе — обычный горизонтальный ряд. Drag между колонками
            работает в обоих режимах: все колонки в DOM, просто проскроллены. */}
        <div className="flex min-h-0 flex-1 snap-x snap-mandatory gap-4 overflow-x-auto pb-24 sm:snap-none sm:pb-28">
          {shownStatuses.map((status) => {
            const perColumn = settings?.[status];
            const color = resolveColumnColor(perColumn, defaults?.[status], status);
            const label = resolveColumnLabel(perColumn, STATUS_LABEL[status]);
            return (
              <KanbanColumn
                key={status}
                status={status}
                label={label}
                tasks={hideDone && status === 'done' ? [] : grouped[status]}
                onCreate={(s) => setDialog({ mode: 'create', status: s })}
                onEdit={(t) => setDialog({ mode: 'edit', task: t })}
                onDelete={handleDelete}
                showShortId={showCommits}
                onQuickPromote={status === 'backlog' ? handleQuickPromote : undefined}
                onTaskChanged={() => void refetch()}
                showCheckbox
                lastDoneTaskId={lastDoneTaskId}
                lastTodoTaskId={lastTodoTaskId}
                currentUserId={user?.id ?? null}
                activeId={activeId}
                dropTarget={dropTarget?.status === status ? dropTarget : null}
                liveTaskIds={liveTaskIds}
                colorClasses={KANBAN_COLOR_CLASSES[color]}
                onInlineCreate={(input) => create({ ...input, status: input.status ?? status })}
                isInbox={isInbox}
                isShared={isShared}
                aiProjectId={isInbox ? null : projectId}
                composerStorageKey={`pf:quick-add:${projectId}:${status}`}
                selectionMode={selectionStatus === status}
                selectedIds={selectionStatus === status ? selectedIds : undefined}
                onSelectToggle={handleSelectToggle}
                onSelectAll={handleSelectAll}
                onSelectNone={handleSelectNone}
                onExitSelection={exitSelection}
                onEnterSelection={() => enterSelection(status)}
                columnMenu={
                  <KanbanColumnMenu
                    status={status}
                    currentColor={color}
                    currentLabel={label}
                    onColor={(c) => setColor(status, c)}
                    onLabel={(l) => setLabel(status, l)}
                    onHide={() => setHidden(status, true)}
                    onSelect={() => enterSelection(status)}
                  />
                }
                headerExtra={
                  status === 'done' ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      onClick={toggleDoneOrder}
                      aria-label={
                        doneOrder === 'newest'
                          ? 'Сейчас сверху новые. Показать сначала старые'
                          : 'Сейчас сверху старые. Показать сначала новые'
                      }
                      title={doneOrder === 'newest' ? 'Сверху новые' : 'Сверху старые'}
                    >
                      {doneOrder === 'newest' ? (
                        <ArrowDownNarrowWide className="size-4" />
                      ) : (
                        <ArrowUpNarrowWide className="size-4" />
                      )}
                    </Button>
                  ) : undefined
                }
              />
            );
          })}
          <KanbanHiddenColumnsMenu
            hidden={hiddenColumns}
            onShow={(status) => setHidden(status, false)}
          />
        </div>
        <DragOverlay dropAnimation={DROP_ANIMATION}>
          {activeTask ? (
            // Tilt + scale живут на motion-обёртке, а не на CSS карточки — иначе оверлей
            // приземляется в позицию, но наклон ещё «висит» (CSS-трансформа запечена
            // в snapshot DragOverlay). previewPhase переключается на 'settled' в момент
            // drop'а, motion лерпит rotate/scale к identity синхронно с position-lerp'ом.
            <motion.div
              initial={false}
              animate={
                previewPhase === 'lifted'
                  ? { rotate: 2, scale: 1.04 }
                  : { rotate: 0, scale: 1 }
              }
              transition={{ duration: DROP_DURATION_MS / 1000, ease: DROP_EASING_BEZIER }}
              style={{ transformOrigin: 'center' }}
            >
              <KanbanCard
                task={activeTask}
                onEdit={() => undefined}
                onDelete={() => undefined}
                preview
                showShortId={showCommits}
              />
            </motion.div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <TaskDrawer
        state={dialog}
        onClose={() => setDialog(null)}
        onSubmit={handleDialogSubmit}
        onCommitsChange={() => void refetch()}
        showCommits={showCommits}
        projectName={projectName}
        backlogTail={backlogTail}
        todoTail={todoTail}
        isInbox={isInbox}
        isShared={isShared}
        aiProjectId={isInbox ? null : projectId}
        onMove={async (taskId, targetStatus) => {
          await move(taskId, {
            targetStatus,
            beforeTaskId: null,
            afterTaskId: null,
          });
          // Обновляем dialog-state чтобы drawer показывал новый статус сразу.
          setDialog((prev) => {
            if (prev?.mode !== 'edit' || prev.task.id !== taskId) return prev;
            return { mode: 'edit', task: { ...prev.task, status: targetStatus } };
          });
        }}
      />

      {/* Floating quick-add (position: fixed). DOM-позиция значения не имеет —
          важно лишь чтобы компонент был смонтирован. Скрываем во время выделения,
          чтобы не конкурировать с панелью массовых действий. */}
      {selectionStatus === null && (
        <QuickAddTodo
          isInbox={isInbox}
          isShared={isShared}
          aiProjectId={isInbox ? null : projectId}
          onCreate={(input) => create({ ...input, status: input.status ?? 'todo' })}
        />
      )}

      {/* Панель массовых действий — поверх доски, когда выбрана хотя бы одна задача. */}
      {selectionStatus !== null && selectedIds.size > 0 && (
        <BulkActionBar
          selectedIds={selectionOrderedIds.filter((id) => selectedIds.has(id))}
          projectId={projectId}
          isInbox={isInbox}
          currentUserId={user?.id ?? null}
          moveTargets={shownStatuses.map((s) => ({
            status: s,
            label: resolveColumnLabel(settings?.[s], STATUS_LABEL[s]),
          }))}
          bulk={bulk}
          onExit={exitSelection}
        />
      )}
    </div>
  );
}
