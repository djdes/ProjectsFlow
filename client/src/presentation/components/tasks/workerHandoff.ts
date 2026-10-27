import { Bot } from 'lucide-react';
import { isFree, type UsageSummary } from '@/domain/usage/Usage';
import { useWorkerEnabled } from '@/presentation/hooks/useWorkerEnabled';
import { useUsage } from '@/presentation/usage/UsageProvider';

// Shared «hand the task to the worker» card action: the project board (KanbanCard) and the
// inbox queue (AssignedToMeBlock) render the same icon and label. Which statuses qualify —
// canSendToWorker in statusLabels.
export const WORKER_HANDOFF_LABEL = 'Передать воркеру';
export const WorkerHandoffIcon = Bot;

// Free plan keeps the «Воркер» column locked behind an upgrade offer; admins are not gated.
export function isWorkerLockedByPlan(usage: UsageSummary | null): boolean {
  return usage !== null && isFree(usage.plan) && !usage.isAdmin;
}

// Worker is on in the current workspace and the plan allows queueing tasks for it.
export function useWorkerHandoffAvailable(): boolean {
  const workerEnabled = useWorkerEnabled();
  const { usage } = useUsage();
  return workerEnabled && !isWorkerLockedByPlan(usage);
}
