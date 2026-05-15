import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import { GithubNotConnectedError } from '../../domain/github/errors.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';
import { KbRepoAlreadyConnectedError, KbDocumentNotFoundError } from '../../domain/kb/errors.js';
import type { KbRepository } from './KbRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly tokens: GithubTokenRepository;
  readonly kb: KbRepository;
};

export class ConnectKbRepo {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, ownerUserId: string, fullName: string): Promise<void> {
    const project = await this.deps.projects.getByIdForOwner(projectId, ownerUserId);
    if (!project) throw new ProjectNotFoundError();
    if (project.kbRepoFullName) throw new KbRepoAlreadyConnectedError();

    const token = await this.deps.tokens.getWithTokenByUserId(ownerUserId);
    if (!token) throw new GithubNotConnectedError();

    const exists = await this.deps.kb.exists(token.accessToken, fullName);
    if (!exists) throw new KbDocumentNotFoundError(fullName);

    await this.deps.projects.update(projectId, ownerUserId, { kbRepoFullName: fullName });
  }
}
