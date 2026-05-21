import type { AgentJob } from '../../domain/agentJob/AgentJob';

export type AgentJobRepository = {
  enqueue(projectId: string, taskId: string): Promise<AgentJob>;
  cancel(projectId: string, jobId: string, reason?: string): Promise<void>;
};
