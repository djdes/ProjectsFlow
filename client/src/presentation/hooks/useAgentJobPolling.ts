import { useEffect } from 'react';
import type { Task } from '@/domain/task/Task';
import { isActiveAgentJobStatus } from '@/domain/agentJob/AgentJob';

const POLL_INTERVAL_MS = 5000;

/**
 * Запускает периодический refetch tasks-списка пока есть task'и с активной
 * agent-job. Когда ни одного активного — таймер выключается.
 */
export function useAgentJobPolling(tasks: readonly Task[], refetch: () => void | Promise<void>): void {
  useEffect(() => {
    const hasActive = tasks.some(
      (t) => t.agentJob && isActiveAgentJobStatus(t.agentJob.status),
    );
    if (!hasActive) return;
    const interval = setInterval(refetch, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [tasks, refetch]);
}
