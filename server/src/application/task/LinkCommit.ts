import { TaskNotFoundError } from '../../domain/task/errors.js';
import {
  GithubNotConnectedError,
  GithubRepoUrlInvalidError,
} from '../../domain/github/errors.js';
import type { TaskCommit } from '../../domain/task/TaskCommit.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { GithubApiClient } from '../github/GithubApiClient.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import { parseGithubOwnerRepo } from '../github/ListProjectCommits.js';
import {
  logDelegatedUsage,
  resolveEffectiveGithubToken,
} from '../github/resolveEffectiveGithubToken.js';
import type { GitTokenDelegationRepository } from '../project/GitTokenDelegationRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { TaskRepository } from './TaskRepository.js';
import type { TaskCommitRepository } from './TaskCommitRepository.js';
import type { TaskVersionRecorder } from './TaskVersionRecorder.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly taskCommits: TaskCommitRepository;
  readonly tokens: GithubTokenRepository;
  readonly api: GithubApiClient;
  // v0.16+: для fallback'а на делегированный токен когда у caller'а нет своего GH.
  readonly delegations: GitTokenDelegationRepository;
  readonly users: UserRepository;
  readonly versions?: TaskVersionRecorder;
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
    const { project } = await requireProjectAccess(
      this.deps,
      input.projectId,
      input.ownerUserId,
      'link_commit',
    );
    if (!project.gitRepoUrl) throw new GithubRepoUrlInvalidError('');

    const task = await this.deps.tasks.getById(input.taskId);
    if (!task || task.projectId !== input.projectId) throw new TaskNotFoundError(input.taskId);

    const parsed = parseGithubOwnerRepo(project.gitRepoUrl);
    if (!parsed) throw new GithubRepoUrlInvalidError(project.gitRepoUrl);

    // v0.16+: используем effective-token (свой → делегированный owner'а/member'а
    // если caller — диспетчер этого проекта). Это разблокирует admin-диспетчеров
    // без собственного GitHub: они получают токен любого согласившегося грантера.
    const eff = await resolveEffectiveGithubToken(this.deps, input.ownerUserId, input.projectId);
    if (!eff) throw new GithubNotConnectedError();

    // Тянем сам коммит с GitHub чтобы snapshot был валидный (sha может быть произвольный).
    const commit = await this.deps.api.getCommit(eff.accessToken, {
      owner: parsed.owner,
      repo: parsed.repo,
      sha: input.sha,
    });

    // Audit-log: если использовали делегацию — owner увидит в access-log'е что
    // мы брали его токен для link_commit. Fire-and-forget — ошибки логирования
    // не должны валить успешный link.
    void logDelegatedUsage(this.deps.delegations, input.projectId, input.ownerUserId, eff, 'link_commit')
      .catch(() => {});

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
      await this.deps.tasks.update(input.taskId, { status: 'in_progress' }, input.ownerUserId);
    }
    if (linked) {
      const current = await this.deps.tasks.getById(input.taskId);
      if (current) {
        await this.deps.versions?.record(current, input.ownerUserId, current, ['commits']);
      }
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
