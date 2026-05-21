import { useContainer } from '@/infrastructure/di/container';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Bot } from 'lucide-react';
import { useState } from 'react';

type Props = {
  projectId: string;
  taskId: string;
  hasDescription: boolean;
  onEnqueued: () => void;
};

export function DelegateToAgentButton({
  projectId,
  taskId,
  hasDescription,
  onEnqueued,
}: Props): React.ReactElement {
  const { enqueueAgentJob } = useContainer();
  const [busy, setBusy] = useState(false);

  async function handleClick(e: React.MouseEvent): Promise<void> {
    e.stopPropagation();
    if (busy || !hasDescription) return;
    setBusy(true);
    try {
      await enqueueAgentJob.execute(projectId, taskId);
      toast.success('Задача отдана агенту');
      onEnqueued();
    } catch (err) {
      toast.error('Не удалось отдать агенту', { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!hasDescription) return <></>;

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-6 cursor-pointer text-muted-foreground hover:text-foreground"
      onClick={handleClick}
      disabled={busy}
      aria-label="Отдать агенту"
      title="Отдать агенту"
    >
      <Bot className="size-3.5" />
    </Button>
  );
}
