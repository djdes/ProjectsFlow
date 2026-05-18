import {
  AgentDeviceCodeConsumedError,
  AgentDeviceCodeDeniedError,
  AgentDeviceCodeExpiredError,
  AgentDeviceCodeNotFoundError,
  AgentDeviceCodePendingError,
} from '../../domain/agent/errors.js';
import type { AgentDeviceCodeStore } from './AgentDeviceCodeStore.js';

type Deps = {
  readonly store: AgentDeviceCodeStore;
  readonly now: () => Date;
};

export type PollAgentDeviceTokenCommand = {
  readonly deviceCode: string;
};

export type PollAgentDeviceTokenResult = {
  readonly accessToken: string;
  readonly tokenName: string;
};

export class PollAgentDeviceToken {
  constructor(private readonly deps: Deps) {}

  execute(input: PollAgentDeviceTokenCommand): PollAgentDeviceTokenResult {
    const entry = this.deps.store.getByDeviceCode(input.deviceCode);
    if (!entry) throw new AgentDeviceCodeNotFoundError();

    if (entry.expiresAt.getTime() <= this.deps.now().getTime()) {
      this.deps.store.expire(entry.deviceCode);
      throw new AgentDeviceCodeExpiredError();
    }

    switch (entry.status) {
      case 'pending':
        throw new AgentDeviceCodePendingError();
      case 'denied':
        throw new AgentDeviceCodeDeniedError();
      case 'consumed':
        throw new AgentDeviceCodeConsumedError();
      case 'expired':
        throw new AgentDeviceCodeExpiredError();
      case 'approved': {
        const consumed = this.deps.store.consume(input.deviceCode);
        if (!consumed) throw new AgentDeviceCodeConsumedError();
        return {
          accessToken: consumed.plaintextToken,
          tokenName: entry.agentTokenName ?? 'Claude Code',
        };
      }
    }
  }
}
