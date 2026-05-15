import type { GithubTokenRepository } from './GithubTokenRepository.js';

export class DisconnectGithub {
  constructor(private readonly tokens: GithubTokenRepository) {}

  execute(userId: string): Promise<void> {
    return this.tokens.delete(userId);
  }
}
