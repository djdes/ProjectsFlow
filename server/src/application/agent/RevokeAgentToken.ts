import { AgentTokenNotFoundError } from '../../domain/agent/errors.js';
import type { AgentTokenRepository } from './AgentTokenRepository.js';

type Deps = {
  readonly tokens: AgentTokenRepository;
};

export class RevokeAgentToken {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string, tokenId: string): Promise<void> {
    const ok = await this.deps.tokens.revoke(tokenId, userId);
    if (!ok) throw new AgentTokenNotFoundError();
  }
}
