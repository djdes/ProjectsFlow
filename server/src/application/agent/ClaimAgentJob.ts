import type { AgentJob } from '../../domain/agent/AgentJob.js';
import {
  AgentJobAlreadyClaimedError,
  AgentJobNotFoundError,
} from '../../domain/agent/errors.js';
import {
  InsufficientProjectRoleError,
  ProjectNotFoundError,
} from '../../domain/project/errors.js';
import { can } from '../../domain/project/permissions.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { AgentJobRepository } from './AgentJobRepository.js';

type Deps = {
  readonly members: ProjectMemberRepository;
  readonly agentJobs: AgentJobRepository;
};

export class ClaimAgentJob {
  constructor(private readonly deps: Deps) {}

  async execute(input: { userId: string; jobId: string }): Promise<AgentJob> {
    const job = await this.deps.agentJobs.findById(input.jobId);
    if (!job) throw new AgentJobNotFoundError(input.jobId);

    // Permissions: на момент claim'а, не enqueue'а — роли могли быть отозваны.
    const membership = await this.deps.members.findForProject(job.projectId, input.userId);
    if (!membership) throw new ProjectNotFoundError();
    if (!can(membership.role, 'delegate_task_to_agent')) {
      throw new InsufficientProjectRoleError(membership.role, 'delegate_task_to_agent');
    }

    const claimed = await this.deps.agentJobs.claimById(input.jobId);
    if (!claimed) throw new AgentJobAlreadyClaimedError(input.jobId);
    return claimed;
  }
}
