import { useState } from 'react';
import { Loader2, Octagon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import type { Task } from '@/domain/task/Task';
import { useContainer } from '@/infrastructure/di/container';

type Props = {
  task: Task;
  // Последняя задача в backlog — для расчёта beforeTaskId при move().
  backlogTail: { readonly id: string } | null;
  onCancelled: () => void;
};

export function CancelWorkButton({ task, backlogTail, onCancelled }: Props): React.ReactElement {
  const { taskRepository, cancelAgentJob } = useContainer();
  const [busy, setBusy] = useState(false);

  const handleClick = async (): Promise<void> => {
    if (busy) return;
    if (!window.confirm('Остановить выполнение и вернуть задачу в черновики?')) return;
    setBusy(true);
    try {
      // 1. Cancel agent-job if it's in cancellable state. Race с succeeded/failed
      // вероятна → ошибку «cannot cancel» проглатываем (no client-side error class,
      // server возвращает message содержащий "cancel").
      const job = task.agentJob;
      if (job && (job.status === 'queued' || job.status === 'running')) {
        try {
          await cancelAgentJob.execute(task.projectId, job.id);
        } catch (e) {
          if (!/cancel/i.test((e as Error).message)) throw e;
        }
      }
      // 2. Move в конец backlog.
      await taskRepository.move(task.projectId, task.id, {
        targetStatus: 'backlog',
        beforeTaskId: backlogTail?.id ?? null,
        afterTaskId: null,
      });
      // 3. Системный (user) комментарий.
      await taskRepository.createComment(
        task.projectId,
        task.id,
        'Отменено пользователем',
      );
      toast.success('Работа отменена, задача в черновиках');
      onCancelled();
    } catch (e) {
      toast.error(`Не удалось отменить: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t bg-background/95 px-3 py-3 backdrop-blur-md">
      <Button
        type="button"
        variant="destructive"
        className="w-full gap-2"
        onClick={() => void handleClick()}
        disabled={busy}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Octagon className="size-4" />}
        Отменить работу
      </Button>
    </div>
  );
}
