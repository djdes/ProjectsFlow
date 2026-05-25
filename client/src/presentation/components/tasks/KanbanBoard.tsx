import { useEffect, useMemo, useRef, useState } from 'react';
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
import { useDoneSortOrder, type DoneSortOrder } from '@/presentation/hooks/useDoneSortOrder';
import { KanbanCard } from './KanbanCard';
import { KanbanColumn } from './KanbanColumn';
import { FinanceSummaryCard } from './FinanceSummaryCard';
import { TaskDialog, type TaskDialogState } from './TaskDialog';

type Props = {
  projectId: string;
  // Если false — TaskDialog не показывает секцию коммитов. Для inbox-проекта так:
  // у него нет git-репо, привязывать нечего.
  showCommits?: boolean;
  // Имя проекта — пробрасывается в TaskDialog как контекстный заголовок. В inbox не передаём.
  projectName?: string;
};

const COLUMN_LABELS: Record<TaskStatus, string> = {
  // Backlog — колонка слева для задач на triage / approval. Карточки в ней получают
  // стрелку → для быстрого перевода в TODO без drag'а.
  backlog: 'На подтверждении',
  todo: 'TODO',
  in_progress: 'В работе',
  // Активная задача на паузе: ждёт ответа человека (ralph-question, разбор retry-fail,
  // переформулировка). Эмодзи 🤔 — спецификация awaiting_clarification.
  awaiting_clarification: '🤔 На уточнении',
  done: 'Готово',
};

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
  const out: Record<TaskStatus, Task[]> = {
    backlog: [],
    todo: [],
    in_progress: [],
    awaiting_clarification: [],
    done: [],
  };
  for (const t of tasks) out[t.status].push(t);
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

export function KanbanBoard({ projectId, showCommits = true, projectName }: Props): React.ReactElement {
  const { tasks, loading, error, create, update, move, remove, refetch } = useTasks(projectId);
  const [dialog, setDialog] = useState<TaskDialogState | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  // Deep-link из email-кнопки: ?task=<id> открывает диалог задачи (один раз после загрузки).
  const deepLinkedRef = useRef(false);
  useEffect(() => {
    if (deepLinkedRef.current || loading) return;
    const taskId = searchParams.get('task');
    if (!taskId) return;
    deepLinkedRef.current = true;
    const task = tasks.find((t) => t.id === taskId);
    if (task) setDialog({ mode: 'edit', task });
    // Чистим query, чтобы повторное открытие/refetch не дёргали диалог.
    const next = new URLSearchParams(searchParams);
    next.delete('task');
    setSearchParams(next, { replace: true });
  }, [loading, tasks, searchParams, setSearchParams]);
  const [activeId, setActiveId] = useState<string | null>(null);
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

  const handleDragStart = (e: DragStartEvent): void => {
    // Если drop-таймер ещё висит от предыдущего перетаскивания — гасим, иначе он позже
    // обнулит activeId уже нового drag'а.
    if (dropTimerRef.current) {
      clearTimeout(dropTimerRef.current);
      dropTimerRef.current = null;
    }
    setActiveId(String(e.active.id));
    setPreviewPhase('lifted');
  };

  const handleDragEnd = async (e: DragEndEvent): Promise<void> => {
    // 1) motion начинает лерпить rotate/scale обратно к identity.
    setPreviewPhase('settled');
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
      targetStatus = overTask.status;
    }

    // Список карточек в целевой колонке БЕЗ перетаскиваемой (чтобы корректно посчитать соседей).
    const targetList = grouped[targetStatus].filter((t) => t.id !== activeTask.id);

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

    // No-op: ничего не изменилось.
    if (
      activeTask.status === targetStatus &&
      (beforeTask?.id ?? null) ===
        (grouped[activeTask.status].filter((t) => t.id !== activeTask.id)[insertIndex - 1]?.id ?? null)
    ) {
      // Дропнули туда же где было — пропускаем сетевой запрос.
      const currentList = grouped[activeTask.status];
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

  const handleDialogSubmit = async (input: { description: string }): Promise<Task> => {
    if (!dialog) throw new Error('Dialog state missing');
    if (dialog.mode === 'create') {
      return create({ ...input, status: dialog.status });
    }
    return update(dialog.task.id, input);
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
          {TASK_STATUSES.map((s) => (
            <div
              key={s}
              className="h-64 w-[82vw] max-w-[20rem] shrink-0 animate-pulse rounded-lg bg-muted sm:w-72 sm:max-w-none"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  return (
    <div className="space-y-6">
      <FinanceSummaryCard projectId={projectId} />
      <DndContext
        sensors={sensors}
        measuring={MEASURING_CONFIG}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* На мобиле колонки занимают почти всю ширину и «прилипают» при свайпе
            (snap), на десктопе — обычный горизонтальный ряд. Drag между колонками
            работает в обоих режимах: все колонки в DOM, просто проскроллены. */}
        <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4 sm:snap-none">
          {TASK_STATUSES.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              label={COLUMN_LABELS[status]}
              tasks={grouped[status]}
              onCreate={(s) => setDialog({ mode: 'create', status: s })}
              onEdit={(t) => setDialog({ mode: 'edit', task: t })}
              onDelete={handleDelete}
              showShortId={showCommits}
              onQuickPromote={status === 'backlog' ? handleQuickPromote : undefined}
              onTaskChanged={() => void refetch()}
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
          ))}
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

      <TaskDialog
        state={dialog}
        onClose={() => setDialog(null)}
        onSubmit={handleDialogSubmit}
        onCommitsChange={() => void refetch()}
        showCommits={showCommits}
        projectName={projectName}
      />
    </div>
  );
}
