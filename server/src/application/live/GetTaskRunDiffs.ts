import type { GithubApiClient } from '../github/GithubApiClient.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import { parseGithubOwnerRepo } from '../github/ListProjectCommits.js';
import { logDelegatedUsage, resolveEffectiveGithubToken } from '../github/resolveEffectiveGithubToken.js';
import type { GitTokenDelegationRepository } from '../project/GitTokenDelegationRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskCommitRepository } from '../task/TaskCommitRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { LiveSession } from '../../domain/live/LiveSession.js';
import type { LiveFileDiff } from '../../domain/live/LiveFileDiff.js';

type Deps = {
  projects: ProjectRepository; tokens: GithubTokenRepository; delegations: GitTokenDelegationRepository;
  users: UserRepository; api: GithubApiClient; commits: TaskCommitRepository;
};

// The checkout can have fetched unrelated main commits while a worker ran.
// Only task-marked commits linked during this execution contribute to its report.
export class GetTaskRunDiffs {
  constructor(private readonly deps: Deps) {}

  async execute(session: LiveSession, userId: string): Promise<readonly LiveFileDiff[] | null> {
    const project = await this.deps.projects.getById(session.projectId);
    if (!project?.gitRepoUrl) return null; // Snapshot projects have no Git synchronization.
    const parsed = parseGithubOwnerRepo(project.gitRepoUrl);
    if (!parsed) return [];
    const marker = `[${session.taskId.slice(0, 8).toLowerCase()}]`;
    const commits = (await this.deps.commits.listByTask(session.taskId))
      .filter(commit => commit.message.toLowerCase().includes(marker) && commit.linkedAt >= session.startedAt)
      .sort((a, b) => a.committedAt.getTime() - b.committedAt.getTime() || a.sha.localeCompare(b.sha));
    if (!commits.length) return [];
    if (commits.length > 30) throw new Error('task_run_commit_limit');
    const token = await resolveEffectiveGithubToken(this.deps, userId, session.projectId);
    if (!token) throw new Error('task_run_git_unavailable');
    const files = new Map<string, LiveFileDiff>();
    for (const linked of commits) {
      const commit = await this.deps.api.getCommit(token.accessToken, { ...parsed, sha: linked.sha });
      if (!commit.message.toLowerCase().includes(marker)) throw new Error('task_run_commit_mismatch');
      if (!commit.files || (commit.changedFiles ?? 0) > commit.files.length) throw new Error('task_run_diff_incomplete');
      for (const file of commit.files) {
        const previous = files.get(file.path);
        const patch = file.patch === null ? null : `--- a/${file.path}\n+++ b/${file.path}\n${file.patch}\n`;
        const combined = [previous?.unifiedDiff, patch].filter(Boolean).join('\n');
        files.set(file.path, {
          path: file.path,
          change: file.status === 'removed' ? 'deleted' : previous?.change === 'added' || file.status === 'added' ? 'added' : file.status === 'renamed' ? 'renamed' : 'modified',
          additions: (previous?.additions ?? 0) + file.additions,
          deletions: (previous?.deletions ?? 0) + file.deletions,
          unifiedDiff: combined ? combined.slice(0, 120_000) : null,
          isBinary: file.patch === null && file.additions === 0 && file.deletions === 0,
          truncated: !!previous?.truncated || combined.length > 120_000 || (file.patch === null && (file.additions > 0 || file.deletions > 0)),
        });
      }
    }
    await logDelegatedUsage(this.deps.delegations, session.projectId, userId, token, 'live_diff').catch(() => {});
    return [...files.values()];
  }
}
