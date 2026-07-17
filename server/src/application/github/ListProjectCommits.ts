import type { GithubCommit } from '../../domain/github/GithubConnection.js';
import {
  GithubNotConnectedError,
  GithubRepoUrlInvalidError,
} from '../../domain/github/errors.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { GithubApiClient } from './GithubApiClient.js';
import type { GithubTokenRepository } from './GithubTokenRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tokens: GithubTokenRepository;
  readonly api: GithubApiClient;
};

const DEFAULT_LIMIT = 10;

/**
 * Парсит owner/repo из URL вида:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo.git
 *   git@github.com:owner/repo.git
 */
export function parseGithubOwnerRepo(url: string): { owner: string; repo: string } | null {
  const trimmed = url.trim();
  // HTTPS form
  const httpsMatch = trimmed.match(/^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s.#?]+)(?:\.git)?(?:[/?#].*)?$/i);
  if (httpsMatch) return { owner: httpsMatch[1]!, repo: httpsMatch[2]! };
  // SSH form
  const sshMatch = trimmed.match(/^git@github\.com:([^/\s]+)\/([^/\s.]+)(?:\.git)?$/i);
  if (sshMatch) return { owner: sshMatch[1]!, repo: sshMatch[2]! };
  return null;
}

export class ListProjectCommits {
  constructor(private readonly deps: Deps) {}

  async execute(
    projectId: string,
    ownerUserId: string,
    limit = DEFAULT_LIMIT,
    opts: { detailSince?: Date; detailLimit?: number } = {},
  ): Promise<GithubCommit[]> {
    const { project } = await requireProjectAccess(this.deps, projectId, ownerUserId, 'read_project');
    if (!project.gitRepoUrl) return [];

    const parsed = parseGithubOwnerRepo(project.gitRepoUrl);
    if (!parsed) throw new GithubRepoUrlInvalidError(project.gitRepoUrl);

    const tokenRow = await this.deps.tokens.getWithTokenByUserId(ownerUserId);
    if (!tokenRow) throw new GithubNotConnectedError();

    const commits = await this.deps.api.listRecentCommits(tokenRow.accessToken, {
      owner: parsed.owner,
      repo: parsed.repo,
      limit,
    });
    if (!opts.detailSince) return commits;

    // GitHub's commits list does not contain files/stats/patches. Enrich a bounded
    // set of the most meaningful-looking daily candidates so the AI reviews code,
    // not only commit titles, without burning the API quota on every old commit.
    const detailLimit = Math.max(1, Math.min(opts.detailLimit ?? 12, 20));
    const candidates = commits
      .filter((commit) => commit.committedAt >= opts.detailSince!)
      .filter((commit) => !/^merge\b/i.test(commit.message.trim()))
      .sort((left, right) => commitDetailScore(right) - commitDetailScore(left))
      .slice(0, detailLimit);
    const detailed = await Promise.all(
      candidates.map((commit) =>
        this.deps.api
          .getCommit(tokenRow.accessToken, {
            owner: parsed.owner,
            repo: parsed.repo,
            sha: commit.sha,
          })
          .catch(() => commit),
      ),
    );
    const bySha = new Map(detailed.map((commit) => [commit.sha, commit] as const));
    return commits.map((commit) => bySha.get(commit.sha) ?? commit);
  }
}

function commitDetailScore(commit: GithubCommit): number {
  const message = commit.message.trim();
  let score = Math.min(message.length, 120) / 120;
  if (/^(feat|fix|refactor|perf|security|revert)(\(.+?\))?!?:/i.test(message)) score += 5;
  else if (/^(test|build|ci)(\(.+?\))?!?:/i.test(message)) score += 2;
  if (/^(chore|style|docs)(\(.+?\))?!?:/i.test(message)) score -= 2;
  return score;
}
