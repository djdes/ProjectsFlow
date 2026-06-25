import { useState } from 'react';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import type { Task } from '@/domain/task/Task';
import { DeadlinePicker } from './DeadlinePicker';
import { META_CHIP_CLASS } from './MetaChip';

type Props = {
  task: Task;
  onChanged?: () => void;
  // Класс на триггер пикера — для Notion-ряда свойств (PROPERTY_VALUE_CLASS).
  // По умолчанию — META_CHIP_CLASS (исторический chip-вид).
  className?: string;
  // Текст в пустом состоянии триггера. Для ряда свойств — «Пусто».
  emptyLabel?: string;
  // Запретить правку (done-задача) — значение всё равно показываем.
  disabled?: boolean;
};

// Chip-обёртка вокруг DeadlinePicker для шапки TaskDrawer'а в edit-mode.
// При изменении сразу PATCH.
export function TaskDeadlineChip({
  task,
  onChanged,
  className = META_CHIP_CLASS,
  emptyLabel,
  disabled = false,
}: Props): React.ReactElement {
  const { taskRepository } = useContainer();
  const [value, setValue] = useState<string | null>(task.deadline ?? null);
  const [saving, setSaving] = useState(false);

  const change = async (next: string | null): Promise<void> => {
    const prev = value;
    setValue(next);
    setSaving(true);
    try {
      await taskRepository.update(task.projectId, task.id, { deadline: next });
      onChanged?.();
    } catch (e) {
      setValue(prev);
      toast.error(`Не удалось: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DeadlinePicker
      value={value}
      onChange={(v) => void change(v)}
      disabled={saving || disabled}
      className={className}
      emptyLabel={emptyLabel}
    />
  );
}
