import { ProjectNotFoundError } from '../../domain/project/errors.js';
import { TaskNotFoundError } from '../../domain/task/errors.js';
import {
  GithubNotConnectedError,
  GithubRepoUrlInvalidError,
} from '../../domain/github/errors.js';
import type { TaskCommit } from '../../domain/task/TaskCommit.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { GithubApiClient } from '../github/GithubApiClient.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import { parseGithubOwnerRepo } from '../github/ListProjectCommits.js';
import type { TaskRepository } from './TaskRepository.js';
import type { TaskCommitRepository } from './TaskCommitRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly tasks: TaskRepository;
  readonly taskCommits: TaskCommitRepository;
  readonly tokens: GithubTokenRepository;
  readonly api: GithubApiClient;
};

export type LinkCommitCommand = {
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly taskId: string;
  readonly sha: string;
};

export class LinkCommit {
  constructor(private readonly deps: Deps) {}

  async execute(input: LinkCommitCommand): Promise<TaskCommit> {
    const project = await this.deps.projects.getByIdForOwner(input.projectId, input.ownerUserId);
    if (!project) throw new ProjectNotFoundError();
    if (!project.gitRepoUrl) throw new GithubRepoUrlInvalidError('');

    const task = await this.deps.tasks.getById(input.taskId);
    if (!task || task.projectId !== input.projectId) throw new TaskNotFoundError(input.taskId);

    const parsed = parseGithubOwnerRepo(project.gitRepoUrl);
    if (!parsed) throw new GithubRepoUrlInvalidError(project.gitRepoUrl);

    const tokenRow = await this.deps.tokens.getWithTokenByUserId(input.ownerUserId);
    if (!tokenRow) throw new GithubNotConnectedError();

    // Тянем сам коммит с GitHub чтобы snapshot был валидный (sha может быть произвольный).
    const commit = await this.deps.api.getCommit(tokenRow.accessToken, {
      owner: parsed.owner,
      repo: parsed.repo,
      sha: input.sha,
    });

    const { linked } = await this.deps.taskCommits.link({
      taskId: input.taskId,
      sha: commit.sha,
      message: commit.message,
      authorName: commit.authorName,
      authorAvatarUrl: commit.authorAvatarUrl,
      htmlUrl: commit.htmlUrl,
      committedAt: commit.committedAt,
    });

    // Auto-transition: первый коммит на задаче со статусом 'todo' → 'in_progress'.
    // Position не трогаем — карточка останется со своей позицией внутри новой колонки
    // (kanban отсортирует по position; для очень новых задач это OK).
    if (linked && task.status === 'todo') {
      await this.deps.tasks.update(input.taskId, { status: 'in_progress' });
    }

    return {
      taskId: input.taskId,
      sha: commit.sha,
      message: commit.message,
      authorName: commit.authorName,
      authorAvatarUrl: commit.authorAvatarUrl,
      htmlUrl: commit.htmlUrl,
      committedAt: commit.committedAt,
      linkedAt: new Date(),
    };
  }
}
