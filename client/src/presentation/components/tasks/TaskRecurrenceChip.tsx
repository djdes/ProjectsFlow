import { useRef, useState } from 'react';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import type { Task } from '@/domain/task/Task';
import { recurrenceAnchorDate, type TaskRecurrence } from '@/domain/task/TaskRecurrence';
import { TaskRecurrenceSelect } from './TaskRecurrenceSelect';
import { META_CHIP_CLASS } from './MetaChip';

type Props = {
  task: Task;
  onChanged?: () => void;
  className?: string;
  // Запретить правку (нет прав) — значение всё равно показываем.
  disabled?: boolean;
};

// Ряд «Повтор» в окне задачи: выбор правила сразу сохраняется (PATCH), ошибка — тост и
// откат. Следующую задачу ставит сервер, когда эту выполнят.
export function TaskRecurrenceChip({
  task,
  onChanged,
  className = META_CHIP_CLASS,
  disabled = false,
}: Props): React.ReactElement {
  const { taskRepository } = useContainer();
  const [value, setValue] = useState<TaskRecurrence | null>(task.recurrence ?? null);
  // Дни недели переключают подряд, не закрывая меню: пикер не блокируем на время запроса,
  // а откат после ошибки делаем только для последнего изменения — устаревший ответ не
  // должен перетирать более свежий выбор.
  const latest = useRef(0);

  const change = async (next: TaskRecurrence | null): Promise<void> => {
    const request = ++latest.current;
    const prev = value;
    setValue(next);
    try {
      await taskRepository.update(task.projectId, task.id, { recurrence: next });
      if (request === latest.current) onChanged?.();
    } catch (e) {
      if (request !== latest.current) return;
      setValue(prev);
      toast.error(`Не удалось: ${(e as Error).message}`);
    }
  };

  return (
    <TaskRecurrenceSelect
      value={value}
      onChange={(next) => void change(next)}
      anchorDate={recurrenceAnchorDate(task.deadline, new Date())}
      disabled={disabled}
      className={className}
    />
  );
}
