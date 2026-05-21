import type { AgentJob } from '../../domain/agent/AgentJob.js';
import { InsufficientProjectRoleError, ProjectNotFoundError } from '../../domain/project/errors.js';
import { can } from '../../domain/project/permissions.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { AgentJobRepository } from './AgentJobRepository.js';

const DEFAULT_LIMIT = 50;

type Deps = {
  readonly members: ProjectMemberRepository;
  readonly agentJobs: AgentJobRepository;
};

export class ListAgentJobsForProject {
  constructor(private readonly deps: Deps) {}

  async execute(input: { userId: string; projectId: string }): Promise<AgentJob[]> {
    const membership = await this.deps.members.findForProject(input.projectId, input.userId);
    if (!membership) throw new ProjectNotFoundError();
    if (!can(membership.role, 'read_project')) {
      throw new InsufficientProjectRoleError(membership.role, 'read_project');
    }
    return this.deps.agentJobs.listForProject(input.projectId, DEFAULT_LIMIT);
  }
}
