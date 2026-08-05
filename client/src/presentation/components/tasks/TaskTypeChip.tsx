import { useState } from 'react';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import type { Task, TaskType } from '@/domain/task/Task';
import { TaskTypeSelect } from './TaskTypeSelect';
import { META_CHIP_CLASS } from './MetaChip';

type Props = {
  task: Task;
  onChanged?: () => void;
  className?: string;
  // Запретить правку (done-задача / нет прав) — значение всё равно показываем.
  disabled?: boolean;
};

// Chip-обёртка вокруг TaskTypeSelect для ряда свойств TaskDrawer'а.
// При изменении сразу PATCH (best-effort, error → toast + откат значения).
export function TaskTypeChip({
  task,
  onChanged,
  className = META_CHIP_CLASS,
  disabled = false,
}: Props): React.ReactElement {
  const { taskRepository } = useContainer();
  const [value, setValue] = useState<TaskType | null>(task.taskType ?? null);
  const [saving, setSaving] = useState(false);

  const change = async (next: TaskType | null): Promise<void> => {
    const prev = value;
    setValue(next);
    setSaving(true);
    try {
      await taskRepository.update(task.projectId, task.id, { taskType: next });
      onChanged?.();
    } catch (e) {
      setValue(prev);
      toast.error(`Не удалось: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <TaskTypeSelect
      value={value}
      onChange={(v) => void change(v)}
      disabled={saving || disabled}
      compact
      className={className}
    />
  );
}
