import {
  InsufficientProjectRoleError,
  ProjectNotFoundError,
} from '../../domain/project/errors.js';
import type {
  GitTokenAccessLogEntry,
  GitTokenDelegationRepository,
} from './GitTokenDelegationRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly delegations: GitTokenDelegationRepository;
};

// Owner смотрит «кто и когда брал мой GitHub-токен через этот проект».
// Только owner — это его personal audit, viewer/editor не должны видеть.
export class ListGitTokenAccessLog {
  constructor(private readonly deps: Deps) {}

  async execute(
    projectId: string,
    callerUserId: string,
    limit: number,
  ): Promise<GitTokenAccessLogEntry[]> {
    const project = await this.deps.projects.getById(projectId);
    if (!project) throw new ProjectNotFoundError();
    if (project.ownerId !== callerUserId) {
      throw new InsufficientProjectRoleError('viewer', 'view_git_token_access_log');
    }
    return this.deps.delegations.listAccessLog(projectId, limit);
  }
}
