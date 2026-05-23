import { AgentTokenNotFoundError } from '../../domain/agent/errors.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { AgentTokenRepository } from './AgentTokenRepository.js';

type Deps = {
  readonly tokens: AgentTokenRepository;
  readonly projects: ProjectRepository;
};

export class RevokeAgentToken {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string, tokenId: string): Promise<void> {
    const ok = await this.deps.tokens.revoke(tokenId, userId);
    if (!ok) throw new AgentTokenNotFoundError();
    // Если это был ПОСЛЕДНИЙ активный токен юзера — он перестал быть ralph-capable,
    // снимаем его с роли диспетчера во всех проектах. Иначе у проектов остался бы
    // диспетчер без работающего MCP — никто не выполняет задачи, юзер этого не видит.
    const remaining = await this.deps.tokens.countActiveByUser(userId);
    if (remaining === 0) {
      await this.deps.projects.clearDispatcherForUser(userId);
    }
  }
}
