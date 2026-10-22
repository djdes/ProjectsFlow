import { Loader2 } from 'lucide-react';
import { useWorkerActivity } from '@/presentation/hooks/useWorkerActivity';

export function WorkerActivityBadge({ projectId, taskId, initialRunning = false }: {
  projectId: string; taskId: string; initialRunning?: boolean;
}): React.ReactElement | null {
  const running = useWorkerActivity(projectId, taskId);
  if (!(running ?? initialRunning)) return null;
  return <span role="status" aria-label="Воркер работает над задачей" className="mbs-1 inline-flex max-w-full items-center gap-1.5 rounded-full bg-primary-soft px-2 py-0.5 text-2xs font-medium text-primary-ink">
    <Loader2 className="size-3 shrink-0 motion-safe:animate-spin" aria-hidden />Воркер работает
  </span>;
}
