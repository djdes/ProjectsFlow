import type { AgentJob } from '../../domain/agent/AgentJob.js';

export type AgentJobDto = {
  readonly id: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly status: AgentJob['status'];
  readonly attempt: number;
  readonly claimedAt: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly error: string | null;
  readonly prUrl: string | null;
  readonly branchName: string | null;
  readonly runnerPid: number | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export function agentJobToDto(j: AgentJob): AgentJobDto {
  return {
    id: j.id,
    projectId: j.projectId,
    taskId: j.taskId,
    status: j.status,
    attempt: j.attempt,
    claimedAt: j.claimedAt?.toISOString() ?? null,
    startedAt: j.startedAt?.toISOString() ?? null,
    finishedAt: j.finishedAt?.toISOString() ?? null,
    error: j.error,
    prUrl: j.prUrl,
    branchName: j.branchName,
    runnerPid: j.runnerPid,
    createdBy: j.createdBy,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  };
}
