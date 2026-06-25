import { useState } from 'react';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import type { Task, TaskPriority } from '@/domain/task/Task';
import { PrioritySelect } from './PrioritySelect';
import { META_CHIP_CLASS } from './MetaChip';

type Props = {
  task: Task;
  onChanged?: () => void;
  // Класс на триггер пикера — для Notion-ряда свойств (PROPERTY_VALUE_CLASS).
  // По умолчанию — META_CHIP_CLASS (исторический chip-вид).
  className?: string;
  // Запретить правку (done-задача) — значение всё равно показываем.
  disabled?: boolean;
};

// Chip-обёртка вокруг PrioritySelect для шапки TaskDrawer'а в edit-mode.
// При изменении сразу PATCH (best-effort, error → toast).
export function TaskPriorityChip({
  task,
  onChanged,
  className = META_CHIP_CLASS,
  disabled = false,
}: Props): React.ReactElement {
  const { taskRepository } = useContainer();
  const [value, setValue] = useState<TaskPriority | null>(task.priority ?? null);
  const [saving, setSaving] = useState(false);

  const change = async (next: TaskPriority | null): Promise<void> => {
    const prev = value;
    setValue(next);
    setSaving(true);
    try {
      await taskRepository.update(task.projectId, task.id, { priority: next });
      onChanged?.();
    } catch (e) {
      setValue(prev);
      toast.error(`Не удалось: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <PrioritySelect
      value={value}
      onChange={(v) => void change(v)}
      disabled={saving || disabled}
      compact
      className={className}
    />
  );
}
