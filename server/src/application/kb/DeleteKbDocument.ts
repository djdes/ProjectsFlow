import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import { GithubNotConnectedError } from '../../domain/github/errors.js';
import { KbDocumentNotFoundError, KbNotConnectedError } from '../../domain/kb/errors.js';
import type { KbRepository } from './KbRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tokens: GithubTokenRepository;
  readonly kb: KbRepository;
};

export class DeleteKbDocument {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, userId: string, path: string): Promise<void> {
    const { project } = await requireProjectAccess(this.deps, projectId, userId, 'manage_kb');
    if (!project.kbRepoFullName) throw new KbNotConnectedError();
    // KB-репо под аккаунтом владельца — пишем его токеном (общий доступ всем участникам).
    const token = await this.deps.tokens.getWithTokenByUserId(project.ownerId);
    if (!token) throw new GithubNotConnectedError();

    const existing = await this.deps.kb.readOne({
      accessToken: token.accessToken, fullName: project.kbRepoFullName, path,
    });
    if (!existing || !existing.sha) throw new KbDocumentNotFoundError(path);

    await this.deps.kb.delete({
      accessToken: token.accessToken,
      fullName: project.kbRepoFullName,
      path, sha: existing.sha,
      message: `chore(kb): delete ${path} via ProjectsFlow UI`,
    });
  }
}
