import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import { GithubNotConnectedError } from '../../domain/github/errors.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';
import { KbDocumentNotFoundError, KbNotConnectedError } from '../../domain/kb/errors.js';
import type { KbRepository } from './KbRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly tokens: GithubTokenRepository;
  readonly kb: KbRepository;
};

export class DeleteKbDocument {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, userId: string, path: string): Promise<void> {
    const project = await this.deps.projects.getByIdForOwner(projectId, userId);
    if (!project) throw new ProjectNotFoundError();
    if (!project.kbRepoFullName) throw new KbNotConnectedError();
    const token = await this.deps.tokens.getWithTokenByUserId(userId);
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
