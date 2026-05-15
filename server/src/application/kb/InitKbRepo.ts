import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import { GithubNotConnectedError } from '../../domain/github/errors.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';
import { KbRepoAlreadyConnectedError } from '../../domain/kb/errors.js';
import type { KbRepository } from './KbRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly tokens: GithubTokenRepository;
  readonly kb: KbRepository;
};

function slugify(name: string): string {
  return name.trim().toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'project';
}

export class InitKbRepo {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, ownerUserId: string): Promise<{ fullName: string }> {
    const project = await this.deps.projects.getByIdForOwner(projectId, ownerUserId);
    if (!project) throw new ProjectNotFoundError();
    if (project.kbRepoFullName) throw new KbRepoAlreadyConnectedError();

    const token = await this.deps.tokens.getWithTokenByUserId(ownerUserId);
    if (!token) throw new GithubNotConnectedError();

    const slug = slugify(project.name);
    const repoName = `${slug}-kb`;
    const description = `ProjectsFlow knowledge base for ${project.name}`;

    const { fullName } = await this.deps.kb.createRepo({
      accessToken: token.accessToken, name: repoName, description,
    });
    await this.deps.kb.initFolders(token.accessToken, fullName);

    await this.deps.projects.update(projectId, ownerUserId, { kbRepoFullName: fullName });

    return { fullName };
  }
}
