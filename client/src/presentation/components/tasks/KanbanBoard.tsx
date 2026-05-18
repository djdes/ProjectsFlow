import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { toast } from '@/components/ui/sonner';
import type { Task, TaskStatus } from '@/domain/task/Task';
import { TASK_STATUSES } from '@/domain/task/Task';
import { useTasks } from '@/presentation/hooks/useTasks';
import { KanbanCard } from './KanbanCard';
import { KanbanColumn } from './KanbanColumn';
import { PipelinePanel } from './PipelinePanel';
import { TaskDialog, type TaskDialogState } from './TaskDialog';

type Props = {
  projectId: string;
};

const COLUMN_LABELS: Record<TaskStatus, string> = {
  todo: 'TODO',
  in_progress: 'В работе',
  done: 'Готово',
};

function groupByStatus(tasks: Task[]): Record<TaskStatus, Task[]> {
  const out: Record<TaskStatus, Task[]> = { todo: [], in_progress: [], done: [] };
  for (const t of tasks) out[t.status].push(t);
  for (const s of TASK_STATUSES) out[s].sort((a, b) => a.position - b.position);
  return out;
}

export function KanbanBoard({ projectId }: Props): React.ReactElement {
  const { tasks, loading, error, create, update, move, remove, refetch } = useTasks(projectId);
  const [dialog, setDialog] = useState<TaskDialogState | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Чувствительность: 5px минимум до старта drag — иначе одиночный клик ловится как drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const grouped = useMemo(() => groupByStatus(tasks), [tasks]);
  const activeTask = activeId ? tasks.find((t) => t.id === activeId) ?? null : null;

  const handleDragStart = (e: DragStartEvent): void => {
    setActiveId(String(e.active.id));
  };

  const handleDragEnd = async (e: DragEndEvent): Promise<void> => {
    setActiveId(null);
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

  const handleDialogSubmit = async (input: { description: string }): Promise<void> => {
    if (!dialog) return;
    if (dialog.mode === 'create') {
      await create({ ...input, status: dialog.status });
    } else {
      await update(dialog.task.id, input);
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
        <div className="flex gap-4">
          {TASK_STATUSES.map((s) => (
            <div key={s} className="h-64 w-72 animate-pulse rounded-lg bg-muted" />
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
      <PipelinePanel tasks={tasks} />
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {TASK_STATUSES.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              label={COLUMN_LABELS[status]}
              tasks={grouped[status]}
              onCreate={(s) => setDialog({ mode: 'create', status: s })}
              onEdit={(t) => setDialog({ mode: 'edit', task: t })}
              onDelete={handleDelete}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTask ? (
            <KanbanCard
              task={activeTask}
              onEdit={() => undefined}
              onDelete={() => undefined}
              preview
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      <TaskDialog
        state={dialog}
        onClose={() => setDialog(null)}
        onSubmit={handleDialogSubmit}
        onCommitsChange={() => void refetch()}
      />
    </div>
  );
}
