import type { AgentToken } from '../../domain/agent/AgentToken.js';
import type { AgentTokenRepository } from './AgentTokenRepository.js';

type Deps = {
  readonly tokens: AgentTokenRepository;
};

export class ListAgentTokens {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string): Promise<AgentToken[]> {
    return this.deps.tokens.listByUser(userId);
  }
}
