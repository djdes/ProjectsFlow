import {
  AgentJobNotCancellableError,
  AgentJobNotFoundError,
} from '../../domain/agent/errors.js';
import {
  InsufficientProjectRoleError,
  ProjectNotFoundError,
} from '../../domain/project/errors.js';
import { can } from '../../domain/project/permissions.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { AgentJobRepository } from './AgentJobRepository.js';

export type CancelAgentJobInput = {
  userId: string;
  projectId: string;
  jobId: string;
  reason?: string;
};

export class CancelAgentJob {
  constructor(
    private readonly deps: {
      members: ProjectMemberRepository;
      agentJobs: AgentJobRepository;
    },
  ) {}

  async execute(input: CancelAgentJobInput): Promise<void> {
    const membership = await this.deps.members.findForProject(input.projectId, input.userId);
    if (!membership) throw new ProjectNotFoundError();
    if (!can(membership.role, 'cancel_agent_job')) {
      throw new InsufficientProjectRoleError(membership.role, 'cancel_agent_job');
    }

    const job = await this.deps.agentJobs.findById(input.jobId);
    if (!job || job.projectId !== input.projectId) {
      throw new AgentJobNotFoundError(input.jobId);
    }
    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
      throw new AgentJobNotCancellableError(input.jobId, job.status);
    }

    // queued -> просто помечаем; running -> в Plan B будет signal на runner для SIGTERM.
    // В Plan A реализуем только пометку; runner ещё не существует.
    await this.deps.agentJobs.cancel(input.jobId, input.reason ?? 'cancelled by user');
  }
}
