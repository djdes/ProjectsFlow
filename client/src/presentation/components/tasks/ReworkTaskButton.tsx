import { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useContainer } from '@/infrastructure/di/container';
import { toast } from '@/components/ui/sonner';

type Props = {
  projectId: string;
  taskId: string;
  disabled?: boolean;
  className?: string;
};

// «Переработка» — постит маркер-комментарий ralph-rework-request (зеркало механизма
// кнопки «План»). Ralph подхватит маркер и переработает результат предыдущей попытки.
export function ReworkTaskButton({
  projectId,
  taskId,
  disabled = false,
  className,
}: Props): React.ReactElement {
  const { taskRepository } = useContainer();
  const [submitting, setSubmitting] = useState(false);

  const handleRework = async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await taskRepository.createComment(
        projectId,
        taskId,
        '🔄 Запрошена переработка\n\n<!-- ralph-rework-request {"v":1} -->',
        { mode: 'none' },
      );
      toast.success('Переработка запрошена — Ralph пересоберёт результат');
    } catch (e) {
      toast.error(`Не удалось запросить переработку: ${(e as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <button
      type="button"
      disabled={disabled || submitting}
      onClick={() => void handleRework()}
      title="Переработать: Ralph заново выполнит задачу и переделает результат прошлой попытки"
      aria-label="Переработать результат"
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40',
        className,
      )}
    >
      {submitting ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
    </button>
  );
}
