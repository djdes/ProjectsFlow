import type { AgentJobRepository } from './AgentJobRepository';
import type { AgentJob } from '../../domain/agentJob/AgentJob';

export class EnqueueAgentJob {
  constructor(private readonly repo: AgentJobRepository) {}
  async execute(projectId: string, taskId: string): Promise<AgentJob> {
    return this.repo.enqueue(projectId, taskId);
  }
}
