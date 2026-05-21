import type { AgentJobRepository } from '../../application/agentJob/AgentJobRepository';
import type { AgentJob } from '../../domain/agentJob/AgentJob';
import { httpClient } from './httpClient';

export class HttpAgentJobRepository implements AgentJobRepository {
  async enqueue(projectId: string, taskId: string): Promise<AgentJob> {
    const { job } = await httpClient.post<{ job: AgentJob }>(
      `/projects/${projectId}/tasks/${taskId}/agent`,
    );
    return job;
  }

  async cancel(projectId: string, jobId: string): Promise<void> {
    await httpClient.delete<void>(`/projects/${projectId}/agent-jobs/${jobId}`);
  }
}
