import type { GithubApiClient } from '../github/GithubApiClient.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import {
  GithubApiError,
  GithubEmptyRepoAlreadyExistsError,
  GithubImportRepoNotEmptyError,
  GithubImportRepoNotFoundError,
  GithubImportRepoNotWritableError,
  GithubNotConnectedError,
  GithubRepoNameTakenError,
} from '../../domain/github/errors.js';
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
    target:
      | { readonly kind: 'new'; readonly name: string; readonly privateRepo: boolean }
      | { readonly kind: 'existing'; readonly fullName: string };
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

    let destination: Awaited<ReturnType<GithubApiClient['createRepo']>>;
    let createdByProjectsFlow = false;

    if (input.target.kind === 'new') {
      try {
        destination = await this.deps.api.createRepo(token.accessToken, {
          name: input.target.name,
          description: `ProjectsFlow: ${project.name}`,
          privateRepo: input.target.privateRepo,
          // GitHub Git Database API отвечает 409 для полностью пустого репозитория.
          // Начальный commit создаёт branch; importRepoFiles сразу заменит его дерево.
          autoInit: true,
        });
        createdByProjectsFlow = true;
      } catch (error) {
        if (error instanceof GithubApiError && error.status === 422) {
          // Имя мог занять собственный забытый пустой repo. Возвращаем UI достаточно
          // данных, чтобы предложить безопасно использовать его вместо тупиковой ошибки.
          const user = await this.deps.api.getAuthenticatedUser(token.accessToken);
          const existing = await this.deps.api.getRepoImportTarget(
            token.accessToken,
            `${user.login}/${input.target.name}`,
          );
          if (existing?.empty && existing.canPush) {
            throw new GithubEmptyRepoAlreadyExistsError(existing.fullName, existing.htmlUrl);
          }
          throw new GithubRepoNameTakenError(input.target.name);
        }
        throw error;
      }
    } else {
      const existing = await this.deps.api.getRepoImportTarget(
        token.accessToken,
        input.target.fullName,
      );
      if (!existing) throw new GithubImportRepoNotFoundError(input.target.fullName);
      if (!existing.canPush) throw new GithubImportRepoNotWritableError(existing.fullName);
      if (!existing.empty) throw new GithubImportRepoNotEmptyError(existing.fullName);
      destination = existing;
    }

    try {
      await this.deps.api.importRepoFiles(
        token.accessToken,
        destination.fullName,
        destination.defaultBranch,
        files.map((file) => ({ path: file.path, contentBase64: file.content.toString('base64') })),
        'chore: import project from ProjectsFlow',
        { requireEmpty: !createdByProjectsFlow },
      );
      await this.deps.projects.update(input.projectId, {
        gitRepoUrl: destination.htmlUrl,
        appRepoFullName: destination.fullName,
      });
    } catch (error) {
      if (createdByProjectsFlow) {
        await this.deps.api.deleteRepo(token.accessToken, destination.fullName).catch(() => undefined);
      } else if (error instanceof GithubApiError && error.status === 409) {
        throw new GithubImportRepoNotEmptyError(destination.fullName);
      }
      throw error;
    }
    return {
      fullName: destination.fullName,
      gitRepoUrl: destination.htmlUrl,
      fileCount: files.length,
    };
  }
}
