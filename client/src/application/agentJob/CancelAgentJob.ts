import type { AgentJobRepository } from './AgentJobRepository';

export class CancelAgentJob {
  constructor(private readonly repo: AgentJobRepository) {}
  async execute(projectId: string, jobId: string, reason?: string): Promise<void> {
    return this.repo.cancel(projectId, jobId, reason);
  }
}
