import { GithubNotConnectedError } from '../../domain/github/errors.js';
import { KbNotConnectedError } from '../../domain/kb/errors.js';
import type { Project } from '../../domain/project/Project.js';
import type { KbDocument, KbDocumentSummary } from '../../domain/kb/KbDocument.js';
import type { GithubTokenRepository } from '../../application/github/GithubTokenRepository.js';
import type { KbRepository } from '../../application/kb/KbRepository.js';
import type {
  KbDeleteInput,
  KbWriteInput,
  ProjectKbStore,
} from '../../application/kb/ProjectKbStore.js';

// github-бэкенд KB: достаёт токен владельца + kbRepoFullName и делегирует в GithubKbRepository.
export class GithubKbBackend implements ProjectKbStore {
  constructor(
    private readonly deps: { kb: KbRepository; tokens: GithubTokenRepository },
  ) {}

  private async ctx(project: Project): Promise<{ accessToken: string; fullName: string }> {
    if (!project.kbRepoFullName) throw new KbNotConnectedError();
    const token = await this.deps.tokens.getWithTokenByUserId(project.ownerId);
    if (!token) throw new GithubNotConnectedError();
    return { accessToken: token.accessToken, fullName: project.kbRepoFullName };
  }

  async list(project: Project): Promise<KbDocumentSummary[]> {
    const { accessToken, fullName } = await this.ctx(project);
    return this.deps.kb.listAll({ accessToken, fullName });
  }

  async read(project: Project, path: string): Promise<KbDocument | null> {
    const { accessToken, fullName } = await this.ctx(project);
    return this.deps.kb.readOne({ accessToken, fullName, path });
  }

  async write(project: Project, input: KbWriteInput): Promise<{ sha: string }> {
    const { accessToken, fullName } = await this.ctx(project);
    return this.deps.kb.write({
      accessToken,
      fullName,
      path: input.path,
      content: input.content,
      message: input.message,
      sha: input.sha,
    });
  }

  async delete(project: Project, input: KbDeleteInput): Promise<void> {
    const { accessToken, fullName } = await this.ctx(project);
    await this.deps.kb.delete({
      accessToken,
      fullName,
      path: input.path,
      sha: input.sha,
      message: input.message,
    });
  }
}
