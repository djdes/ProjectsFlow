import { useEffect, useState } from 'react';
import { Check, Loader2, Undo2 } from 'lucide-react';
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
  // Заблокировать чекбокс (нет прав менять статус). Рисуем неактивным с тултипом.
  disabled?: boolean;
  disabledTitle?: string;
  // На канбан-карточке действие живёт в общей hover-панели и выглядит как обычная
  // квадратная icon-кнопка. В списке сохраняем привычный круглый чекбокс.
  variant?: 'circle' | 'toolbar';
};

// Круглый чекбокс «выполнено» в строке inbox-задачи. Optimistic UI: тиково
// зачёркивает сразу, под капотом — move в 'done' / restore прежнего статуса.
// При снятии галочки сервер восстанавливает status_before_done (фолбэк 'todo').
export function InboxCheckbox({
  task,
  lastDoneTaskId,
  // lastTodoTaskId оставлен в Props для обратной совместимости вызовов, но в расчёте
  // позиции больше не нужен: при снятии галочки afterTaskId=null (сервер берёт bounds).
  onChanged,
  disabled = false,
  disabledTitle,
  variant = 'circle',
}: Props): React.ReactElement {
  const { taskRepository } = useContainer();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);

  const isDone = optimistic ?? task.status === 'done';

  // Сбрасываем optimistic-оверрайд, когда подъехал реальный статус (refetch/SSE) — иначе
  // в долгоживущих инстансах строк (TaskListView, AssignedToMeBlock) он навсегда затеняет
  // task.status и маскирует внешние изменения.
  useEffect(() => {
    setOptimistic(null);
  }, [task.status]);

  const toggle = async (e: React.MouseEvent | React.PointerEvent): Promise<void> => {
    e.stopPropagation();
    if (pending || disabled) return;
    const next = !isDone;
    setOptimistic(next);
    setPending(true);
    try {
      const targetStatus = next ? 'done' : 'todo';
      // При снятии галочки сервер сам резолвит целевую колонку (status_before_done может
      // быть НЕ todo), поэтому todo-якорь неуместен — отдаём null, сервер возьмёт bounds
      // нужной колонки. При отметке done — якорь на хвост done-колонки.
      const afterTaskId = next ? lastDoneTaskId : null;
      await taskRepository.move(task.projectId, task.id, {
        targetStatus,
        beforeTaskId: null,
        afterTaskId,
        // Снятие галочки → сервер восстановит прежний статус (status_before_done).
        ...(next ? {} : { restore: true }),
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
      disabled={pending || disabled}
      aria-label={isDone ? 'Снять отметку «выполнено»' : 'Отметить выполненным'}
      aria-pressed={isDone}
      title={disabled ? (disabledTitle ?? 'Нет прав менять статус') : isDone ? 'Снять отметку' : 'Выполнено'}
      className={cn(
        'grid shrink-0 place-items-center transition-colors',
        variant === 'toolbar'
          ? cn(
              'size-6 rounded text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-600 max-sm:size-8 dark:hover:text-emerald-400',
              isDone &&
                'bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400',
            )
          : cn(
              'size-5 rounded-full border-2',
              isDone
                ? 'border-emerald-500 bg-emerald-500 text-white'
                : 'border-muted-foreground/40 hover:border-emerald-500',
            ),
        (pending || disabled) && 'opacity-60',
        disabled && 'cursor-not-allowed',
      )}
    >
      {pending ? (
        <Loader2 className="size-3 animate-spin" />
      ) : variant === 'toolbar' && isDone ? (
        <Undo2 className="size-3.5" strokeWidth={2.25} />
      ) : isDone || variant === 'toolbar' ? (
        <Check className="size-3" strokeWidth={3} />
      ) : null}
    </button>
  );
}
