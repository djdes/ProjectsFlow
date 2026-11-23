import { useEffect, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import { deploymentIsActive, type DeploymentStatus } from '@/domain/deployment/DeploymentStatus';
import { onTabReturn } from '@/lib/tabReturn';

// While a deployment runs the notice shows its progress, so the status is polled often; at
// rest (almost always) once a minute is enough to notice that a new one has started.
const ACTIVE_POLL_MS = 10_000;
const IDLE_POLL_MS = 60_000;

export function usePlatformDeployment(): { status: DeploymentStatus | null; observedRun: string | null } {
  const { deploymentRepository } = useContainer();
  const [snapshot, setSnapshot] = useState<{ status: DeploymentStatus | null; observedRun: string | null }>({ status: null, observedRun: null });
  useEffect(() => {
    let closed = false;
    let pending = false;
    let running = false;
    let timer: number | undefined;
    const schedule = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refresh, running ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    };
    function refresh(): void {
      if (closed || pending) return;
      if (document.visibilityState === 'hidden') {
        schedule();
        return;
      }
      pending = true;
      deploymentRepository.getStatus().then(status => {
        if (closed) return;
        running = deploymentIsActive(status.phase);
        setSnapshot(previous => ({ status, observedRun: running
          ? `${status.runId}:${status.attempt}` : previous.observedRun }));
      }).catch(() => {
        if (!closed) setSnapshot(previous => previous.status ? { ...previous, status: { ...previous.status, stale: true } } : previous);
      }).finally(() => {
        pending = false;
        if (!closed) schedule();
      });
    }
    refresh();
    const stopTabReturn = onTabReturn(refresh);
    window.addEventListener('online', refresh);
    return () => {
      closed = true;
      window.clearTimeout(timer);
      stopTabReturn();
      window.removeEventListener('online', refresh);
    };
  }, [deploymentRepository]);
  return snapshot;
}
