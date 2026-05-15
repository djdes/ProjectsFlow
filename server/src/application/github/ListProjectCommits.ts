import type { GithubCommit } from '../../domain/github/GithubConnection.js';
import {
  GithubNotConnectedError,
  GithubRepoUrlInvalidError,
} from '../../domain/github/errors.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';
import type { GithubApiClient } from './GithubApiClient.js';
import type { GithubTokenRepository } from './GithubTokenRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
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

  async execute(projectId: string, ownerUserId: string, limit = DEFAULT_LIMIT): Promise<GithubCommit[]> {
    const project = await this.deps.projects.getByIdForOwner(projectId, ownerUserId);
    if (!project) throw new ProjectNotFoundError();
    if (!project.gitRepoUrl) return [];

    const parsed = parseGithubOwnerRepo(project.gitRepoUrl);
    if (!parsed) throw new GithubRepoUrlInvalidError(project.gitRepoUrl);

    const tokenRow = await this.deps.tokens.getWithTokenByUserId(ownerUserId);
    if (!tokenRow) throw new GithubNotConnectedError();

    return this.deps.api.listRecentCommits(tokenRow.accessToken, {
      owner: parsed.owner,
      repo: parsed.repo,
      limit,
    });
  }
}
