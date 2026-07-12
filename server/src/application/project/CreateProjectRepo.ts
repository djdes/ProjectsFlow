import type { GithubApiClient } from '../github/GithubApiClient.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import {
  GithubApiError,
  GithubNotConnectedError,
  GithubRepoNameTakenError,
} from '../../domain/github/errors.js';
import { ProjectRepoAlreadyConnectedError } from '../../domain/project/errors.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';
import { requireProjectAccess } from './projectAccess.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tokens: GithubTokenRepository;
  readonly api: GithubApiClient;
};

export type CreateProjectRepoInput = {
  readonly name: string;
  readonly privateRepo: boolean;
};

// GitHub возвращает 422, когда имя репо уже занято у пользователя. Невалидные имена
// до GitHub не доходят (zod-схема маршрута), так что 422 здесь ≈ «имя занято».
function isNameTaken(err: unknown): boolean {
  return err instanceof GithubApiError && err.status === 422;
}

// Кнопка «Создать репо» на обзоре проекта: создаёт НОВЫЙ репо под аккаунтом
// ВЫЗЫВАЮЩЕГО (не владельца проекта) его токеном и подключает как gitRepoUrl.
// Editor+. Никаких побочных эффектов app-repo-флоу (делегация, KB, workflow) —
// это отдельная кнопка воркера (EnsureProjectAppRepo).
export class CreateProjectRepo {
  constructor(private readonly deps: Deps) {}

  async execute(
    projectId: string,
    callerUserId: string,
    input: CreateProjectRepoInput,
  ): Promise<{ fullName: string; gitRepoUrl: string }> {
    const { project } = await requireProjectAccess(
      this.deps,
      projectId,
      callerUserId,
      'update_project',
    );
    if (project.gitRepoUrl) throw new ProjectRepoAlreadyConnectedError();

    const token = await this.deps.tokens.getWithTokenByUserId(callerUserId);
    if (!token) throw new GithubNotConnectedError();

    let created: { fullName: string; htmlUrl: string };
    try {
      created = await this.deps.api.createRepo(token.accessToken, {
        name: input.name,
        description: `ProjectsFlow: ${project.name}`,
        privateRepo: input.privateRepo,
        autoInit: true,
      });
    } catch (err) {
      if (isNameTaken(err)) throw new GithubRepoNameTakenError(input.name);
      throw err;
    }

    await this.deps.projects.update(projectId, { gitRepoUrl: created.htmlUrl });
    return { fullName: created.fullName, gitRepoUrl: created.htmlUrl };
  }
}
