import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { Task } from '@/domain/task/Task';
import { useContainer } from '@/infrastructure/di/container';

type Props = {
  task: Task;
  // Последняя задача в целевой колонке (для расчёта позиции через afterTaskId).
  // Done → afterTaskId = последняя done; Todo → afterTaskId = последняя todo.
  // null когда колонка пуста — server рассчитает position от bounds.
  lastDoneTaskId: string | null;
  lastTodoTaskId: string | null;
  onChanged?: () => void;
};

// Круглый чекбокс «выполнено» в строке inbox-задачи. Optimistic UI: тиково
// зачёркивает сразу, под капотом — move в 'done'/'todo'. Возврат всегда в 'todo'
// (предыдущий статус не помним; для inbox это OK).
export function InboxCheckbox({
  task,
  lastDoneTaskId,
  lastTodoTaskId,
  onChanged,
}: Props): React.ReactElement {
  const { taskRepository } = useContainer();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);

  const isDone = optimistic ?? task.status === 'done';

  const toggle = async (e: React.MouseEvent | React.PointerEvent): Promise<void> => {
    e.stopPropagation();
    if (pending) return;
    const next = !isDone;
    setOptimistic(next);
    setPending(true);
    try {
      const targetStatus = next ? 'done' : 'todo';
      const afterTaskId = next ? lastDoneTaskId : lastTodoTaskId;
      await taskRepository.move(task.projectId, task.id, {
        targetStatus,
        beforeTaskId: null,
        afterTaskId,
      });
      onChanged?.();
    } catch (err) {
      setOptimistic(null);
      toast.error(`Не удалось: ${(err as Error).message}`);
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      onPointerDown={(e) => e.stopPropagation()}
      disabled={pending}
      aria-label={isDone ? 'Снять отметку «выполнено»' : 'Отметить выполненным'}
      aria-pressed={isDone}
      title={isDone ? 'Снять отметку' : 'Выполнено'}
      className={cn(
        'grid size-5 shrink-0 place-items-center rounded-full border-2 transition-colors',
        isDone
          ? 'border-emerald-500 bg-emerald-500 text-white'
          : 'border-muted-foreground/40 hover:border-emerald-500',
        pending && 'opacity-60',
      )}
    >
      {pending ? (
        <Loader2 className="size-3 animate-spin" />
      ) : isDone ? (
        <Check className="size-3" strokeWidth={3} />
      ) : null}
    </button>
  );
}
