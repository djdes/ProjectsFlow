import { CircleAlert, Loader2, MessageCircleQuestion } from 'lucide-react';
import { useTaskWorkerActivity } from '@/presentation/hooks/useWorkerActivity';
import { cn } from '@/lib/utils';

export function WorkerActivityBadge({ projectId, taskId, initialRunning = false }: {
  projectId: string; taskId: string; initialRunning?: boolean;
}): React.ReactElement | null {
  const activity = useTaskWorkerActivity(projectId, taskId);
  const state = activity === undefined && initialRunning ? 'running' : activity?.state;
  if (!state) return null;
  const question = state === 'question';
  const failed = state === 'error';
  const label = question ? 'Вопрос диспетчера' : failed ? 'Ошибка воркера' : 'Воркер работает';
  const Icon = question ? MessageCircleQuestion : failed ? CircleAlert : Loader2;
  return <span role="status" data-worker-state={state}
    aria-label={state === 'running' ? 'Воркер работает над задачей' : label}
    title={question ? 'Диспетчер ждёт вашего ответа. Откройте LIVE задачи.' : failed ? 'Последний запуск завершился с ошибкой. Подробности — в LIVE задачи.' : 'Воркер работает над задачей'}
    className={cn('mbs-1 inline-flex max-w-full items-start gap-1.5 rounded-full px-2 py-0.5 text-2xs font-medium',
      question ? 'bg-manual-soft text-manual-ink' : failed ? 'bg-destructive/10 text-destructive' : 'bg-primary-soft text-primary-ink')}>
    <Icon className={cn('h-[1lh] w-[1em] shrink-0', state === 'running' && 'motion-safe:animate-spin')} aria-hidden />{label}
  </span>;
}
