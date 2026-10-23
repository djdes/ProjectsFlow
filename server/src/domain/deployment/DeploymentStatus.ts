export type DeploymentPhase = 'idle' | 'queued' | 'checking' | 'building' | 'deploying' | 'verifying' | 'success' | 'failed' | 'canceled' | 'unknown';
export type DeploymentRun = {
  id: string;
  attempt: number;
  status: string;
  conclusion: string | null;
  revision: string;
  startedAt: string;
  updatedAt: string;
  steps: readonly { name: string; status: string; conclusion: string | null }[];
};
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

export function deploymentPhase(run: DeploymentRun | null, deployedRevision: string | null): DeploymentPhase {
  if (!run) return 'idle';
  if (run.status === 'completed') {
    if (!run.conclusion) return 'unknown';
    if (run.conclusion === 'success') return deployedRevision === run.revision ? 'success' : 'verifying';
    return run.conclusion === 'cancelled' || run.conclusion === 'skipped' ? 'canceled' : 'failed';
  }
  if (run.status !== 'in_progress') return 'queued';
  const step = run.steps.find(step => step.status === 'in_progress');
  if (step && /Upload tarball|Extract, install, migrate, restart/.test(step.name)) return 'deploying';
  if (step && /Build client|Build landing|Build server|Pack release/.test(step.name)) return 'building';
  if (run.steps.some(step => step.name === 'Extract, install, migrate, restart' && step.conclusion === 'success')) return 'verifying';
  return 'checking';
}
