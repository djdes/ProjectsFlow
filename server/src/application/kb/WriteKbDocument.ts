import matter from 'gray-matter';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import { GithubNotConnectedError } from '../../domain/github/errors.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';
import { FrontmatterInvalidError, KbNotConnectedError } from '../../domain/kb/errors.js';
import type { KbRepository } from './KbRepository.js';
import type { Frontmatter } from '../../domain/kb/Frontmatter.js';
import { validateFrontmatter } from './FrontmatterValidator.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly tokens: GithubTokenRepository;
  readonly kb: KbRepository;
};

export type WriteKbDocumentInput = {
  readonly projectId: string;
  readonly userId: string;
  readonly path: string;
  readonly frontmatter: Frontmatter;
  readonly body: string;
  readonly sha: string | null;
};

export class WriteKbDocument {
  constructor(private readonly deps: Deps) {}

  async execute(input: WriteKbDocumentInput): Promise<{ sha: string }> {
    const project = await this.deps.projects.getByIdForOwner(input.projectId, input.userId);
    if (!project) throw new ProjectNotFoundError();
    if (!project.kbRepoFullName) throw new KbNotConnectedError();

    const errors = validateFrontmatter(input.frontmatter, input.body);
    if (errors.length > 0) throw new FrontmatterInvalidError(errors);

    const token = await this.deps.tokens.getWithTokenByUserId(input.userId);
    if (!token) throw new GithubNotConnectedError();

    const content = matter.stringify(input.body, input.frontmatter as Record<string, unknown>);

    return this.deps.kb.write({
      accessToken: token.accessToken,
      fullName: project.kbRepoFullName,
      path: input.path,
      content,
      message: `chore(kb): update ${input.path} via ProjectsFlow UI`,
      sha: input.sha,
    });
  }
}
