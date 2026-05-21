export type AgentJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export const AGENT_JOB_STATUSES: readonly AgentJobStatus[] = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
];

export const ACTIVE_AGENT_JOB_STATUSES: readonly AgentJobStatus[] = ['queued', 'running'];

export type AgentJob = {
  readonly id: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly status: AgentJobStatus;
  readonly attempt: number;
  readonly claimedAt: Date | null;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly error: string | null;
  readonly prUrl: string | null;
  readonly branchName: string | null;
  readonly runnerPid: number | null;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};
