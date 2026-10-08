import { useEffect, useRef } from 'react';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import type { MoveTaskInput } from '@/application/task/TaskRepository';
import type { Task } from '@/domain/task/Task';
import type { UseTasks } from './useTasks';

const reversible = new Set(['backlog', 'manual', 'done']);

/** A short undo window for manual moves; worker and approval transitions stay explicit. */
export function useTaskMoveUndo(
  projectId: string,
  tasks: Task[],
  move: UseTasks['move'],
) {
  const { taskRepository } = useContainer();
  const notices = useRef(new Set<string>());
  useEffect(() => {
    const ids = notices.current;
    return () => {
      for (const id of ids) toast.dismiss(id);
      ids.clear();
    };
  }, [projectId]);
  return async (task: Task, input: MoveTaskInput): Promise<void> => {
    const siblings = tasks
      .filter((item) => item.status === task.status)
      .sort((a, b) => a.position - b.position);
    const index = siblings.findIndex((item) => item.id === task.id);
    const restore: MoveTaskInput = {
      targetStatus: task.status,
      beforeTaskId: siblings[index - 1]?.id ?? null,
      afterTaskId: siblings[index + 1]?.id ?? null,
    };
    await move(task.id, input, (updated) => {
      const id = 'move-undo-' + task.id;
      toast.dismiss(id);
      if (!reversible.has(task.status) || !reversible.has(updated.status))
        return;
      notices.current.add(id);
      let used = false;
      toast.success('Задача перемещена', {
        id,
        duration: 6000,
        action: {
          label: 'Отменить',
          onClick: () => {
            if (used) return;
            used = true;
            void (async () => {
              try {
                // Never knowingly undo a more recent change by a colleague or another screen.
                const current = (
                  await taskRepository.list(task.projectId)
                ).find((item) => item.id === task.id);
                if (
                  !current ||
                  current.updatedAt.getTime() !== updated.updatedAt.getTime() ||
                  current.status !== updated.status ||
                  current.position !== updated.position
                ) {
                  toast.info(
                    'Задача уже изменилась. Откройте её, чтобы проверить статус.',
                  );
                  return;
                }
                await move(task.id, restore);
                toast.success('Перемещение отменено');
              } catch {
                toast.error(
                  'Не удалось отменить перемещение. Попробуйте переместить задачу вручную.',
                );
              }
            })();
          },
        },
      });
    });
  };
}
