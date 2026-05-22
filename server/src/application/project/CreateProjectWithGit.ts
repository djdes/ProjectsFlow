import type { Project } from '../../domain/project/Project.js';
import { GithubNotConnectedError } from '../../domain/github/errors.js';
import type { GithubApiClient } from '../github/GithubApiClient.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import type { CreateProject } from './CreateProject.js';
import type { UpdateProject } from './UpdateProject.js';

// Опция по git-репозиторию при создании проекта. Решение принимает пользователь
// (агент спрашивает перед вызовом): подключить существующий, создать новый, или никакой.
export type CreateProjectGitOption =
  | { readonly mode: 'none' }
  | { readonly mode: 'connect'; readonly gitRepoUrl: string }
  | {
      readonly mode: 'create';
      readonly repoName?: string;
      readonly description?: string;
      readonly private?: boolean;
    };

export type CreateProjectWithGitCommand = {
  readonly ownerId: string;
  readonly name: string;
  readonly git: CreateProjectGitOption;
};

type Deps = {
  readonly createProject: CreateProject;
  readonly updateProject: UpdateProject;
  readonly tokens: GithubTokenRepository;
  readonly api: GithubApiClient;
};

// GitHub допускает в имени репо только ASCII (буквы/цифры/`-`/`_`/`.`). Кириллицу и
// прочее срезаем; если ничего не осталось — fallback. Для кириллических названий
// агенту лучше передавать repoName явно (см. описание MCP-tool'а).
function slugifyRepoName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return slug.length > 0 ? slug : 'project';
}

export class CreateProjectWithGit {
  constructor(private readonly deps: Deps) {}

  async execute(cmd: CreateProjectWithGitCommand): Promise<Project> {
    // 1) Создаём проект (CreateProject сам добавляет создателя owner-member'ом).
    const project = await this.deps.createProject.execute({ ownerId: cmd.ownerId, name: cmd.name });

    // 2) Разбираемся с git по выбору пользователя.
    if (cmd.git.mode === 'create') {
      const tokenRow = await this.deps.tokens.getWithTokenByUserId(cmd.ownerId);
      if (!tokenRow) throw new GithubNotConnectedError();
      const repo = await this.deps.api.createRepo(tokenRow.accessToken, {
        name: cmd.git.repoName?.trim() || slugifyRepoName(cmd.name),
        description: cmd.git.description,
        privateRepo: cmd.git.private ?? true,
        autoInit: true,
      });
      return this.deps.updateProject.execute({
        id: project.id,
        ownerId: cmd.ownerId,
        patch: { gitRepoUrl: repo.htmlUrl },
      });
    }

    if (cmd.git.mode === 'connect') {
      return this.deps.updateProject.execute({
        id: project.id,
        ownerId: cmd.ownerId,
        patch: { gitRepoUrl: cmd.git.gitRepoUrl },
      });
    }

    // mode === 'none' — проект без git.
    return project;
  }
}
