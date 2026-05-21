import type {
  AgentJobRepository,
  PendingAgentJob,
} from './AgentJobRepository.js';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

type Deps = {
  readonly agentJobs: AgentJobRepository;
};

export class ListPendingAgentJobs {
  constructor(private readonly deps: Deps) {}

  async execute(input: { userId: string; limit?: number }): Promise<PendingAgentJob[]> {
    const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    return this.deps.agentJobs.listPendingForUser(input.userId, limit);
  }
}
