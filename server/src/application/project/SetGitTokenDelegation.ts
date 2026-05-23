import type { GitTokenDelegation } from '../../domain/project/GitTokenDelegation.js';
import {
  GithubNotConnectedForDelegationError,
  InsufficientProjectRoleError,
  ProjectNotFoundError,
} from '../../domain/project/errors.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import type { GitTokenDelegationRepository } from './GitTokenDelegationRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly delegations: GitTokenDelegationRepository;
  readonly githubTokens: GithubTokenRepository;
};

export type SetGitTokenDelegationInput = {
  readonly projectId: string;
  readonly callerUserId: string;
  readonly enabled: boolean;
};

// Включить/выключить делегацию GitHub-токена текущему диспетчеру проекта.
// Только owner может менять (явный owner-check, не editor — это про доступ к
// личному OAuth-токену, кейс должен быть строго личный).
// При enabled=true валидируем что у caller'а сейчас подключён GitHub —
// иначе делегировать нечего.
export class SetGitTokenDelegation {
  constructor(private readonly deps: Deps) {}

  async execute(input: SetGitTokenDelegationInput): Promise<GitTokenDelegation> {
    const project = await this.deps.projects.getById(input.projectId);
    if (!project) throw new ProjectNotFoundError();
    // Owner-check без admin-bypass: владельца OAuth-токена админ за него
    // делегировать не должен. Это его личный токен — только он сам.
    if (project.ownerId !== input.callerUserId) {
      throw new InsufficientProjectRoleError('viewer', 'set_git_token_delegation');
    }

    if (input.enabled) {
      const conn = await this.deps.githubTokens.getByUserId(input.callerUserId);
      if (!conn) throw new GithubNotConnectedForDelegationError();
    }

    return this.deps.delegations.upsert({
      projectId: input.projectId,
      granterUserId: input.callerUserId,
      enabled: input.enabled,
    });
  }
}
