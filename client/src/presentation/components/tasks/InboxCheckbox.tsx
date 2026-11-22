import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { playTaskExit, type TaskExitHandle } from '@/lib/taskExitFx';
import { TaskActionIcon } from './TaskActionButton';
import type { Task } from '@/domain/task/Task';
import type { MoveTaskInput } from '@/application/task/TaskRepository';
import { useContainer } from '@/infrastructure/di/container';
import { useCompletedToday } from '@/presentation/hooks/CompletedTodayProvider';

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
  // Переопределение подсказки для незакрытой задачи. Приёмка (db/150): на задаче в очереди
  // утверждения та же кнопка означает «принять работу», а не «отметить выполненной».
  doneTitle?: string;
  // Опциональная замена прямого taskRepository.move: доска передаёт сюда оптимистичный
  // useTasks().move, чтобы отметка «Принять работу» на карточке двигала её между колонками
  // сразу (как drag), а не только после onChanged→refetch. Без него (списки, полки
  // входящих без общего useTasks) поведение прежнее — прямой вызов репозитория.
  move?: (input: MoveTaskInput) => Promise<void>;
  // Анимация отметки «выполнено» (lib/taskExitFx): leave — карточка штампуется зелёной
  // галкой и уходит из списка (там, где выполненные скрыты), pulse — только штамп и зелёная
  // вспышка (карточка остаётся на виду или сама переезжает в видимую колонку).
  // Функция — решение в момент нажатия (доска: видна ли колонка «Готово»).
  exit?: 'leave' | 'pulse' | 'none' | (() => 'leave' | 'pulse');
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
  doneTitle,
  move,
  exit = 'pulse',
}: Props): React.ReactElement {
  const { taskRepository } = useContainer();
  const { celebrate } = useCompletedToday();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  // Идёт анимация отметки (до сетевого запроса): кнопка неактивна, но без спиннера.
  const [animating, setAnimating] = useState(false);

  const isDone = optimistic ?? task.status === 'done';

  // Сбрасываем optimistic-оверрайд, когда подъехал реальный статус (refetch/SSE) — иначе
  // в долгоживущих инстансах строк (TaskListView, AssignedToMeBlock) он навсегда затеняет
  // task.status и маскирует внешние изменения.
  useEffect(() => {
    setOptimistic(null);
  }, [task.status]);

  const toggle = async (e: React.MouseEvent | React.PointerEvent): Promise<void> => {
    e.stopPropagation();
    if (pending || animating || disabled) return;
    const next = !isDone;
    // Кнопка — точка, откуда «штампуется» галка; currentTarget живёт только до await.
    const origin = e.currentTarget as Element;
    let fx: TaskExitHandle | null = null;
    const exitMode = typeof exit === 'function' ? exit() : exit;
    if (next && exitMode !== 'none') {
      setAnimating(true);
      fx = await playTaskExit(task.id, 'complete', { origin, leave: exitMode === 'leave' });
      setAnimating(false);
    }
    setOptimistic(next);
    setPending(true);
    try {
      const targetStatus = next ? 'done' : 'todo';
      // При снятии галочки сервер сам резолвит целевую колонку (status_before_done может
      // быть НЕ todo), поэтому todo-якорь неуместен — отдаём null, сервер возьмёт bounds
      // нужной колонки. При отметке done — якорь на хвост done-колонки.
      const afterTaskId = next ? lastDoneTaskId : null;
      const moveInput: MoveTaskInput = {
        targetStatus,
        beforeTaskId: null,
        afterTaskId,
        // Снятие галочки → сервер восстановит прежний статус (status_before_done).
        ...(next ? {} : { restore: true }),
      };
      // move (если передан) — оптимистичный useTasks().move: карточка на доске переезжает
      // в целевую колонку СРАЗУ, локально, а не только после onChanged→refetch. Без него —
      // прежний прямой вызов репозитория (списки/полки без общего useTasks за доской).
      if (move) await move(moveInput);
      else await taskRepository.move(task.projectId, task.id, moveInput);
      // Праздник и +1 к счётчику — только после подтверждения сервером: оптимистично
      // поднимать цифру нельзя, задачу могло отклонить (нет прав, заморозка приёмкой).
      // Снятие галочки цифру НЕ уменьшает: сервер считает разные задачи по журналу
      // событий, и запись о закрытии никуда не девается — иначе клиент разъезжался бы
      // с сервером до ближайшего обновления.
      if (next) celebrate(task.id);
      onChanged?.();
    } catch (err) {
      fx?.restore();
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
      disabled={pending || animating || disabled}
      aria-label={isDone ? 'Снять отметку «выполнено»' : 'Отметить выполненным'}
      aria-pressed={isDone}
      title={
        disabled
          ? (disabledTitle ?? 'Нет прав менять статус')
          : isDone
            ? 'Снять отметку'
            : (doneTitle ?? 'Выполнено')
      }
      data-tone={variant === 'toolbar' ? (isDone ? 'neutral' : 'done') : undefined}
      className={cn(
        // Дизайн C4: «Готово» — зелёная галочка в плашке быстрых действий (общая коробка
        // .pf-task-action — тот же размер, что у соседних кнопок); уже выполненная — серая
        // «вернуть». В списках — круглый чекбокс, заливка зелёным «Готово».
        variant === 'toolbar'
          ? 'pf-task-action'
          : cn(
              'grid shrink-0 place-items-center rounded-full border-[1.5px] transition-colors',
              'size-[18px]',
              isDone
                ? 'border-done bg-done text-background'
                : 'border-foreground/30 hover:border-done',
            ),
        (pending || disabled) && variant !== 'toolbar' && 'opacity-60',
        disabled && 'cursor-not-allowed',
      )}
    >
      {pending ? (
        <Loader2 className={cn(variant === 'circle' && 'size-3', 'motion-safe:animate-spin')} />
      ) : variant === 'toolbar' ? (
        // key — новая иконка входит поворотом (pf-ai-enter), а не подменяется: тот же объект
        // меняет состояние (галка ↔ «вернуть»).
        <TaskActionIcon key={isDone ? 'undo' : 'check'} name={isDone ? 'undo' : 'check'} className={optimistic !== null ? 'pf-ai-enter' : undefined} />
      ) : isDone ? (
        <TaskActionIcon key="done" name="check" className={cn('size-3 [stroke-width:3]', optimistic !== null && 'pf-ai-enter')} />
      ) : null}
    </button>
  );
}
