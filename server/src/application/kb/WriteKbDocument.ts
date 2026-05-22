import matter from 'gray-matter';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import { FrontmatterInvalidError, KbNotConnectedError } from '../../domain/kb/errors.js';
import type { ProjectKbStore } from './ProjectKbStore.js';
import type { Frontmatter } from '../../domain/kb/Frontmatter.js';
import { validateFrontmatter } from './FrontmatterValidator.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly kb: ProjectKbStore;
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
    const { project } = await requireProjectAccess(this.deps, input.projectId, input.userId, 'manage_kb');
    if (project.kbKind === 'none') throw new KbNotConnectedError();

    const errors = validateFrontmatter(input.frontmatter, input.body);
    if (errors.length > 0) throw new FrontmatterInvalidError(errors);

    const content = matter.stringify(input.body, input.frontmatter as Record<string, unknown>);

    return this.deps.kb.write(project, {
      path: input.path,
      content,
      message: `chore(kb): update ${input.path} via ProjectsFlow UI`,
      sha: input.sha,
    });
  }
}
