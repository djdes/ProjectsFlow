import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import { GithubNotConnectedError } from '../../domain/github/errors.js';
import { KbRepoAlreadyConnectedError, KbDocumentNotFoundError } from '../../domain/kb/errors.js';
import type { KbRepository } from './KbRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tokens: GithubTokenRepository;
  readonly kb: KbRepository;
};

export class ConnectKbRepo {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, ownerUserId: string, fullName: string): Promise<void> {
    const { project } = await requireProjectAccess(this.deps, projectId, ownerUserId, 'manage_kb');
    if (project.kbKind !== 'none') throw new KbRepoAlreadyConnectedError();

    // KB-репо привязываем под аккаунтом владельца проекта — тогда все участники
    // читают его одним (владельца) токеном. См. фикс общих кредов.
    const token = await this.deps.tokens.getWithTokenByUserId(project.ownerId);
    if (!token) throw new GithubNotConnectedError();

    const exists = await this.deps.kb.exists(token.accessToken, fullName);
    if (!exists) throw new KbDocumentNotFoundError(fullName);

    await this.deps.projects.update(projectId, { kbRepoFullName: fullName, kbKind: 'github' });
  }
}
