import {
  GithubNotConnectedError,
  GithubRepoUrlInvalidError,
} from '../../domain/github/errors.js';
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

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly taskCommits: TaskCommitRepository;
  readonly tokens: GithubTokenRepository;
  readonly api: GithubApiClient;
  // v0.16+: fallback на делегированный токен (см. LinkCommit).
  readonly delegations: GitTokenDelegationRepository;
  readonly users: UserRepository;
};

export type SyncResult = {
  // Сколько коммитов из последних N привязали к задачам (новых линков).
  readonly linkedCount: number;
  // Сколько задач авто-перевели todo → in_progress.
  readonly autoTransitionedCount: number;
  // Сколько коммитов проанализировано.
  readonly scannedCount: number;
};

// Парсит [xxxxxxxx] из message — где xxxxxxxx это 8 hex-символов (short-id задачи).
// Возвращает уникальные short-id'ы, найденные в сообщении.
function parseShortIds(message: string): string[] {
  const re = /\[([0-9a-f]{8})\]/gi;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(message)) !== null) {
    found.add(m[1]!.toLowerCase());
  }
  return [...found];
}

// Лимит для одной синхронизации. Если у юзера больше коммитов между sync'ами — он повторит позже.
const SYNC_LIMIT = 50;

export class SyncTaskCommits {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, ownerUserId: string): Promise<SyncResult> {
    const { project } = await requireProjectAccess(this.deps, projectId, ownerUserId, 'link_commit');
    if (!project.gitRepoUrl) throw new GithubRepoUrlInvalidError('');
    const parsed = parseGithubOwnerRepo(project.gitRepoUrl);
    if (!parsed) throw new GithubRepoUrlInvalidError(project.gitRepoUrl);

    // v0.16+: effective-token (свой → делегированный, если caller диспетчер).
    const eff = await resolveEffectiveGithubToken(this.deps, ownerUserId, projectId);
    if (!eff) throw new GithubNotConnectedError();

    void logDelegatedUsage(this.deps.delegations, projectId, ownerUserId, eff, 'sync_commits')
      .catch(() => {});

    const commits = await this.deps.api.listRecentCommits(eff.accessToken, {
      owner: parsed.owner,
      repo: parsed.repo,
      limit: SYNC_LIMIT,
    });

    // Маппинг short-id (8 hex) → полный task.id. Только задачи этого проекта.
    const projectTasks = await this.deps.tasks.listByProject(projectId);
    const byShortId = new Map<string, (typeof projectTasks)[number]>();
    for (const t of projectTasks) {
      const shortId = t.id.replace(/-/g, '').slice(0, 8).toLowerCase();
      byShortId.set(shortId, t);
    }

    let linkedCount = 0;
    let autoTransitionedCount = 0;
    const transitionedTaskIds = new Set<string>();

    for (const commit of commits) {
      const shortIds = parseShortIds(commit.message);
      for (const shortId of shortIds) {
        const task = byShortId.get(shortId);
        if (!task) continue;
        const { linked } = await this.deps.taskCommits.link({
          taskId: task.id,
          sha: commit.sha,
          message: commit.message,
          authorName: commit.authorName,
          authorAvatarUrl: commit.authorAvatarUrl,
          htmlUrl: commit.htmlUrl,
          committedAt: commit.committedAt,
        });
        if (linked) linkedCount++;
        // Auto-transition: один раз на задачу, только если она ещё в TODO.
        if (linked && task.status === 'todo' && !transitionedTaskIds.has(task.id)) {
          await this.deps.tasks.update(task.id, { status: 'in_progress' });
          autoTransitionedCount++;
          transitionedTaskIds.add(task.id);
        }
      }
    }

    return { linkedCount, autoTransitionedCount, scannedCount: commits.length };
  }
}
