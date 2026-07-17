import type { AgentToken } from '../../domain/agent/AgentToken.js';
import {
  AgentCapabilityForbiddenError,
  AgentCapabilityNotFoundError,
} from '../../domain/agent/errors.js';
import type { AgentTokenRepository } from './AgentTokenRepository.js';

type Deps = { readonly tokens: AgentTokenRepository };

export class RevokeProjectWorkerCapability {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string, parentToken: AgentToken, capabilityId: string): Promise<void> {
    if (parentToken.userId !== userId || parentToken.scopeKind !== 'account') {
      throw new AgentCapabilityForbiddenError();
    }
    const revoked = await this.deps.tokens.revokeProjectCapability(
      capabilityId,
      userId,
      parentToken.id,
    );
    if (!revoked) throw new AgentCapabilityNotFoundError();
  }
}
