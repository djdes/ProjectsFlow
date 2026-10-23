import { useEffect, useState } from 'react';
import { useContainer } from '@/infrastructure/di/container';
import { deploymentIsActive, type DeploymentStatus } from '@/domain/deployment/DeploymentStatus';

export function usePlatformDeployment(): { status: DeploymentStatus | null; observedRun: string | null } {
  const { deploymentRepository } = useContainer();
  const [snapshot, setSnapshot] = useState<{ status: DeploymentStatus | null; observedRun: string | null }>({ status: null, observedRun: null });
  useEffect(() => {
    let closed = false;
    let pending = false;
    const refresh = (): void => {
      if (closed || pending || document.visibilityState === 'hidden') return;
      pending = true;
      deploymentRepository.getStatus().then(status => {
        if (closed) return;
        setSnapshot(previous => ({ status, observedRun: deploymentIsActive(status.phase)
          ? `${status.runId}:${status.attempt}` : previous.observedRun }));
      }).catch(() => {
        if (!closed) setSnapshot(previous => previous.status ? { ...previous, status: { ...previous.status, stale: true } } : previous);
      }).finally(() => { pending = false; });
    };
    refresh();
    const interval = window.setInterval(refresh, 10_000);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      closed = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [deploymentRepository]);
  return snapshot;
}
