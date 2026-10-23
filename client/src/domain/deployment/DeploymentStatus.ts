export type DeploymentPhase = 'idle' | 'queued' | 'checking' | 'building' | 'deploying' | 'verifying' | 'success' | 'failed' | 'canceled' | 'unknown';
export type DeploymentStatus = {
  phase: DeploymentPhase;
  runId: string | null;
  attempt: number;
  targetRevision: string | null;
  deployedRevision: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  checkedAt: string;
  stale: boolean;
};

export function deploymentIsActive(phase: DeploymentPhase): boolean {
  return ['queued', 'checking', 'building', 'deploying', 'verifying'].includes(phase);
}

export function newerDeploymentAvailable(status: DeploymentStatus, browserBuild: string): boolean {
  return /^[a-f0-9]{7,40}$/i.test(browserBuild) && !!status.deployedRevision
    && !status.deployedRevision.toLowerCase().startsWith(browserBuild.toLowerCase());
}
