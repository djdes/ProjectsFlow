import { useState } from 'react';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import type { Task } from '@/domain/task/Task';
import { DeadlinePicker } from './DeadlinePicker';

type Props = {
  task: Task;
  onChanged?: () => void;
};

// Chip-обёртка вокруг DeadlinePicker для шапки TaskDrawer'а в edit-mode.
// При изменении сразу PATCH.
export function TaskDeadlineChip({ task, onChanged }: Props): React.ReactElement {
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

  return <DeadlinePicker value={value} onChange={(v) => void change(v)} disabled={saving} />;
}
