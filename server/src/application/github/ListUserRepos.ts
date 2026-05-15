import type { GithubRepoSummary } from '../../domain/github/GithubConnection.js';
import { GithubNotConnectedError } from '../../domain/github/errors.js';
import type { GithubApiClient } from './GithubApiClient.js';
import type { GithubTokenRepository } from './GithubTokenRepository.js';

type Deps = {
  readonly tokens: GithubTokenRepository;
  readonly api: GithubApiClient;
};

export class ListUserRepos {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string): Promise<GithubRepoSummary[]> {
    const tokenRow = await this.deps.tokens.getWithTokenByUserId(userId);
    if (!tokenRow) throw new GithubNotConnectedError();
    return this.deps.api.listUserRepos(tokenRow.accessToken);
  }
}
