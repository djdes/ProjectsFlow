import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import { GithubNotConnectedError } from '../../domain/github/errors.js';
import { KbDocumentNotFoundError, KbNotConnectedError } from '../../domain/kb/errors.js';
import type { KbRepository } from './KbRepository.js';
import type { KbDocument } from '../../domain/kb/KbDocument.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tokens: GithubTokenRepository;
  readonly kb: KbRepository;
};

export class GetKbDocument {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, ownerUserId: string, path: string): Promise<KbDocument> {
    const { project } = await requireProjectAccess(this.deps, projectId, ownerUserId, 'read_project');
    if (!project.kbRepoFullName) throw new KbNotConnectedError();
    // KB-репо под аккаунтом владельца — читаем его токеном (общий доступ всем участникам).
    const token = await this.deps.tokens.getWithTokenByUserId(project.ownerId);
    if (!token) throw new GithubNotConnectedError();
    const doc = await this.deps.kb.readOne({
      accessToken: token.accessToken, fullName: project.kbRepoFullName, path,
    });
    if (!doc) throw new KbDocumentNotFoundError(path);
    return doc;
  }
}
