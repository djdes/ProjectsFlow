import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import { GithubNotConnectedError } from '../../domain/github/errors.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';
import { KbDocumentNotFoundError, KbNotConnectedError } from '../../domain/kb/errors.js';
import type { KbRepository } from './KbRepository.js';
import type { KbDocument } from '../../domain/kb/KbDocument.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly tokens: GithubTokenRepository;
  readonly kb: KbRepository;
};

export class GetKbDocument {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, ownerUserId: string, path: string): Promise<KbDocument> {
    const project = await this.deps.projects.getByIdForOwner(projectId, ownerUserId);
    if (!project) throw new ProjectNotFoundError();
    if (!project.kbRepoFullName) throw new KbNotConnectedError();
    const token = await this.deps.tokens.getWithTokenByUserId(ownerUserId);
    if (!token) throw new GithubNotConnectedError();
    const doc = await this.deps.kb.readOne({
      accessToken: token.accessToken, fullName: project.kbRepoFullName, path,
    });
    if (!doc) throw new KbDocumentNotFoundError(path);
    return doc;
  }
}
