import type { GitTokenDelegation } from '../../domain/project/GitTokenDelegation.js';
import { GithubNotConnectedForDelegationError } from '../../domain/project/errors.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import { requireProjectAccess } from './projectAccess.js';
import type { GitTokenDelegationRepository } from './GitTokenDelegationRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly delegations: GitTokenDelegationRepository;
  readonly githubTokens: GithubTokenRepository;
};

export type SetGitTokenDelegationInput = {
  readonly projectId: string;
  readonly callerUserId: string;
  readonly enabled: boolean;
};

// Включить/выключить делегацию GitHub-токена текущему диспетчеру проекта.
// Доступ: owner или admin (через admin-bypass в requireProjectAccess).
//
// ВАЖНО: granter ВСЕГДА = project.ownerId, даже когда action делает admin.
// Логика: admin «жмёт за owner'а», но делегируется owner'ский токен — не admin'ский.
// Иначе сломается GetDelegatedGitToken (он проверяет granter === project.ownerId).
//
// Соответственно при enabled=true валидируем GitHub-коннект OWNER'а, не actor'а.
export class SetGitTokenDelegation {
  constructor(private readonly deps: Deps) {}

  async execute(input: SetGitTokenDelegationInput): Promise<GitTokenDelegation> {
    const { project } = await requireProjectAccess(
      this.deps,
      input.projectId,
      input.callerUserId,
      'set_git_token_delegation',
    );

    const granterUserId = project.ownerId;

    if (input.enabled) {
      const conn = await this.deps.githubTokens.getByUserId(granterUserId);
      if (!conn) throw new GithubNotConnectedForDelegationError();
    }

    return this.deps.delegations.upsert({
      projectId: input.projectId,
      granterUserId,
      enabled: input.enabled,
    });
  }
}
