export type AgentJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export const ACTIVE_AGENT_JOB_STATUSES: readonly AgentJobStatus[] = ['queued', 'running'];

export function isActiveAgentJobStatus(s: AgentJobStatus): boolean {
  return s === 'queued' || s === 'running';
}

export type AgentJob = {
  readonly id: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly status: AgentJobStatus;
  readonly attempt: number;
  readonly claimedAt: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly error: string | null;
  readonly prUrl: string | null;
  readonly branchName: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};
