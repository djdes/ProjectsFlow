import type { GithubApiClient } from '../github/GithubApiClient.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import { GithubApiError, GithubNotConnectedError, GithubRepoNameTakenError } from '../../domain/github/errors.js';
import { ProjectRepoAlreadyConnectedError } from '../../domain/project/errors.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';
import { extractProjectZip } from './extractProjectZip.js';
import { requireProjectAccess } from './projectAccess.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tokens: GithubTokenRepository;
  readonly api: GithubApiClient;
};

export class ImportProjectRepo {
  constructor(private readonly deps: Deps) {}

  async execute(input: {
    projectId: string;
    callerUserId: string;
    name: string;
    privateRepo: boolean;
    archive: Buffer;
  }): Promise<{ fullName: string; gitRepoUrl: string; fileCount: number }> {
    const { project } = await requireProjectAccess(
      this.deps,
      input.projectId,
      input.callerUserId,
      'update_project',
    );
    if (project.gitRepoUrl) throw new ProjectRepoAlreadyConnectedError();
    const token = await this.deps.tokens.getWithTokenByUserId(input.callerUserId);
    if (!token) throw new GithubNotConnectedError();
    const files = extractProjectZip(input.archive);

    let created: Awaited<ReturnType<GithubApiClient['createRepo']>>;
    try {
      created = await this.deps.api.createRepo(token.accessToken, {
        name: input.name,
        description: `ProjectsFlow: ${project.name}`,
        privateRepo: input.privateRepo,
        autoInit: false,
      });
    } catch (error) {
      if (error instanceof GithubApiError && error.status === 422) {
        throw new GithubRepoNameTakenError(input.name);
      }
      throw error;
    }

    try {
      await this.deps.api.importRepoFiles(
        token.accessToken,
        created.fullName,
        created.defaultBranch,
        files.map((file) => ({ path: file.path, contentBase64: file.content.toString('base64') })),
        'chore: import project from ProjectsFlow',
      );
      await this.deps.projects.update(input.projectId, {
        gitRepoUrl: created.htmlUrl,
        appRepoFullName: created.fullName,
      });
    } catch (error) {
      await this.deps.api.deleteRepo(token.accessToken, created.fullName).catch(() => undefined);
      throw error;
    }
    return { fullName: created.fullName, gitRepoUrl: created.htmlUrl, fileCount: files.length };
  }
}
