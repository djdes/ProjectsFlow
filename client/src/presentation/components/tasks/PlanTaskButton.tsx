import { useState } from 'react';
import { Loader2, Map } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useContainer } from '@/infrastructure/di/container';
import { toast } from '@/components/ui/sonner';

type Props = {
  projectId: string;
  taskId: string;
  disabled?: boolean;
  className?: string;
};

// «План» — постит маркер-комментарий ralph-plan-request. Ralph изучит репозиторий,
// пришлёт план на одобрение (Telegram/дашборд), затем воркер выполнит по плану.
// Логика вынесена из overlay редактора описания в группу действий шапки задачи.
export function PlanTaskButton({
  projectId,
  taskId,
  disabled = false,
  className,
}: Props): React.ReactElement {
  const { taskRepository } = useContainer();
  const [submitting, setSubmitting] = useState(false);

  const handlePlan = async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await taskRepository.createComment(
        projectId,
        taskId,
        '🗺 Запрошен план реализации\n\n<!-- ralph-plan-request {"v":1} -->',
        { mode: 'none' },
      );
      toast.success('План запрошен — Ralph составит и пришлёт на одобрение');
    } catch (e) {
      toast.error(`Не удалось запросить план: ${(e as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <button
      type="button"
      disabled={disabled || submitting}
      onClick={() => void handlePlan()}
      title="Составить план — Ralph изучит код и пришлёт план на одобрение"
      aria-label="Составить план"
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40',
        className,
      )}
    >
      {submitting ? <Loader2 className="size-4 animate-spin" /> : <Map className="size-4" />}
    </button>
  );
}
