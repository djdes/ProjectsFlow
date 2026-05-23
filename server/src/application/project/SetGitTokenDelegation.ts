import type { GitTokenDelegation } from '../../domain/project/GitTokenDelegation.js';
import {
  GithubNotConnectedForDelegationError,
  NotProjectMemberForDelegationError,
  ProjectNotFoundError,
} from '../../domain/project/errors.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { GitTokenDelegationRepository } from './GitTokenDelegationRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly delegations: GitTokenDelegationRepository;
  readonly githubTokens: GithubTokenRepository;
  readonly users: UserRepository;
};

export type SetGitTokenDelegationInput = {
  readonly projectId: string;
  readonly callerUserId: string;
  readonly enabled: boolean;
  // Опционально: целевой granter (для admin-on-behalf). По умолчанию = callerUserId
  // (член проекта включает СВОЮ делегацию). Если указан и !== callerUserId, caller
  // обязан быть admin'ом — иначе 403.
  readonly granterUserId?: string;
};

// v0.15+: per-member opt-in. ЛЮБОЙ член проекта может включить/выключить СВОЮ
// собственную делегацию. Admin (isAdmin=true) может включить/выключить за любого
// члена через optional `granterUserId` (используется в admin-панели).
//
// Проверки:
//   1. Проект существует.
//   2. granter (target) — член project_members этого проекта (admin тоже обязан
//      выбирать только member'ов, иначе кандидат не появится в выборе токена).
//   3. Если caller !== granter — caller обязан быть admin (isAdmin=true).
//   4. Если enabled=true — у granter подключён GitHub (иначе делегировать нечего).
//
// Хранится granterUserId как фактический владелец делегации; actor (admin)
// не записывается — если нужен audit toggle-actions, добавится отдельно.
export class SetGitTokenDelegation {
  constructor(private readonly deps: Deps) {}

  async execute(input: SetGitTokenDelegationInput): Promise<GitTokenDelegation> {
    const project = await this.deps.projects.getById(input.projectId);
    if (!project) throw new ProjectNotFoundError();

    const granterUserId = input.granterUserId ?? input.callerUserId;

    // Если caller действует за другого — это admin-on-behalf, требует isAdmin.
    if (granterUserId !== input.callerUserId) {
      const caller = await this.deps.users.getById(input.callerUserId);
      if (!caller || !caller.isAdmin) {
        throw new NotProjectMemberForDelegationError();
      }
    }

    // Target (granter) обязан быть членом проекта — без этого его токен бесполезен
    // (Ralph всё равно не сможет работать в проекте, не будучи member'ом, кроме
    // случая admin-bypass; но мы строго требуем membership для granter).
    const targetMembership = await this.deps.members.findForProject(
      input.projectId,
      granterUserId,
    );
    if (!targetMembership) {
      throw new NotProjectMemberForDelegationError();
    }

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
