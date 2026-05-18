import {
  AgentDeviceCodeExpiredError,
  AgentDeviceCodeNotFoundError,
} from '../../domain/agent/errors.js';
import type { AgentDeviceCodeStore } from './AgentDeviceCodeStore.js';

type Deps = {
  readonly store: AgentDeviceCodeStore;
  readonly now: () => Date;
};

export type AgentDeviceCodeInfo = {
  readonly userCode: string;
  readonly status: 'pending' | 'approved' | 'consumed' | 'denied' | 'expired';
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly tokenName: string | null;
};

// Read-only view of a device code, для UI'я '/device' страницы.
// Никаких секретов не возвращает — только статус и metadata.
export class GetAgentDeviceCodeInfo {
  constructor(private readonly deps: Deps) {}

  execute(userCode: string): AgentDeviceCodeInfo {
    const entry = this.deps.store.getByUserCode(userCode);
    if (!entry) throw new AgentDeviceCodeNotFoundError();

    if (entry.expiresAt.getTime() <= this.deps.now().getTime() && entry.status === 'pending') {
      this.deps.store.expire(entry.deviceCode);
      throw new AgentDeviceCodeExpiredError();
    }

    return {
      userCode: entry.userCode,
      status: entry.status,
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt,
      tokenName: entry.agentTokenName,
    };
  }
}
