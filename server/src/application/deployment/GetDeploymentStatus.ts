import { deploymentPhase, type DeploymentStatus } from '../../domain/deployment/DeploymentStatus.js';
import type { DeployedRevision, DeploymentStatusRepository } from './DeploymentStatusRepository.js';

// One process-wide snapshot and in-flight read for all browser tabs and accounts.
export class GetDeploymentStatus {
  private cached: DeploymentStatus | null = null;
  private until = 0;
  private pending: Promise<DeploymentStatus> | null = null;
  constructor(private readonly deps: { source: DeploymentStatusRepository; revision: DeployedRevision; now: () => Date; ttlMs?: number }) {}

  execute(): Promise<DeploymentStatus> {
    if (this.cached && this.deps.now().getTime() < this.until) return Promise.resolve(this.cached);
    if (this.pending) return this.pending;
    this.pending = this.load().finally(() => { this.pending = null; });
    return this.pending;
  }

  private async load(): Promise<DeploymentStatus> {
    const now = this.deps.now();
    try {
      const [run, deployedRevision] = await Promise.all([this.deps.source.latest(), this.deps.revision.read()]);
      const phase = deploymentPhase(run, deployedRevision);
      this.cached = {
        phase, runId: run?.id ?? null, attempt: run?.attempt ?? 0,
        // Older clients also must not offer reload during artifact copy/restart.
        targetRevision: run?.revision ?? null, deployedRevision: phase === 'success' ? deployedRevision : null,
        startedAt: run?.startedAt ?? null, updatedAt: run?.updatedAt ?? null, checkedAt: now.toISOString(), stale: false,
      };
    } catch {
      // A rate limit/network failure is not a successful or failed deployment.
      this.cached = this.cached ? { ...this.cached, deployedRevision: null, stale: true } : {
        phase: 'unknown', runId: null, attempt: 0, targetRevision: null, deployedRevision: null,
        startedAt: null, updatedAt: null, checkedAt: now.toISOString(), stale: true,
      };
    }
    this.until = this.deps.now().getTime() + (this.deps.ttlMs ?? 10_000);
    return this.cached;
  }
}
