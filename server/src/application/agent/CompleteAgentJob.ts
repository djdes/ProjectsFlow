import {
  AgentJobNotFoundError,
  AgentJobNotInRunningStateError,
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

export class CompleteAgentJob {
  constructor(private readonly deps: Deps) {}

  async execute(input: {
    readonly userId: string;
    readonly jobId: string;
    readonly ok: boolean;
    readonly prUrl: string | null;
    readonly error: string | null;
    readonly branchName: string | null;
  }): Promise<void> {
    const job = await this.deps.agentJobs.findById(input.jobId);
    if (!job) throw new AgentJobNotFoundError(input.jobId);

    const membership = await this.deps.members.findForProject(job.projectId, input.userId);
    if (!membership) throw new ProjectNotFoundError();
    if (!can(membership.role, 'delegate_task_to_agent')) {
      throw new InsufficientProjectRoleError(membership.role, 'delegate_task_to_agent');
    }

    if (job.status !== 'running') {
      throw new AgentJobNotInRunningStateError(input.jobId, job.status);
    }

    await this.deps.agentJobs.complete(input.jobId, {
      status: input.ok ? 'succeeded' : 'failed',
      error: input.error,
      prUrl: input.prUrl,
      branchName: input.branchName,
    });
  }
}
