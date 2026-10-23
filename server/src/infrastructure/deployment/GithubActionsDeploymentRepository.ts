import type { DeploymentRun } from '../../domain/deployment/DeploymentStatus.js';
import type { DeploymentStatusRepository } from '../../application/deployment/DeploymentStatusRepository.js';

type Run = { id: number; run_attempt: number; head_branch: string; head_sha: string; status: string; conclusion: string | null; created_at: string; updated_at: string };
type Job = { name: string; status: string; steps?: DeploymentRun['steps'] };
type Credential = { accessToken: string; onUsed?: (runId: string) => Promise<void> };

// The platform workflow is fixed by the operator, never supplied by the caller.
export class GithubActionsDeploymentRepository implements DeploymentStatusRepository {
  constructor(private readonly deps: {
    repository: string; workflow: string; getCredential: () => Promise<Credential | null>; fetch?: typeof fetch;
  }) {}

  async latest(): Promise<DeploymentRun | null> {
    if (!/^[\w.-]+\/[\w.-]+$/.test(this.deps.repository) || !/^[\w.-]+\.ya?ml$/.test(this.deps.workflow)) throw new Error('invalid_deployment_source');
    const credential = await this.deps.getCredential();
    if (!credential) throw new Error('deployment_source_unavailable');
    const get = async <T>(path: string): Promise<T> => {
      const response = await (this.deps.fetch ?? fetch)(`https://api.github.com/repos/${this.deps.repository}/${path}`, {
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${credential.accessToken}`, 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.timeout(8000), redirect: 'error',
      });
      if (!response.ok) throw new Error('deployment_source_unavailable');
      return response.json() as Promise<T>;
    };
    const { workflow_runs: all } = await get<{ workflow_runs: Run[] }>(`actions/workflows/${this.deps.workflow}/runs?branch=main&per_page=20`);
    const runs = all.filter(run => run.head_branch === 'main');
    const run = runs.find(run => run.status === 'in_progress') ?? runs.find(run => run.status !== 'completed') ?? runs[0];
    if (!run) return null;
    const { jobs } = await get<{ jobs: Job[] }>(`actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=30`);
    const job = jobs.find(job => job.name === 'deploy') ?? jobs.find(job => job.status === 'in_progress');
    await credential.onUsed?.(String(run.id));
    return { id: String(run.id), attempt: run.run_attempt, status: run.status, conclusion: run.conclusion,
      revision: run.head_sha, startedAt: run.created_at, updatedAt: run.updated_at, steps: job?.steps ?? [] };
  }
}
