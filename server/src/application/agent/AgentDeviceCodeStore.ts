import type { AgentDeviceCode, AgentDeviceCodeStatus } from '../../domain/agent/AgentDeviceCode.js';

// In-memory store для pending device-flow'ов. Однопроцессный — если переедем на multi-instance,
// заменить на Redis (ключи короткоживущие, perfect candidate).
//
// Хранит plaintext-токен между approve и consume (минуты, не часы). Это допустимо т.к.:
// 1) store не сериализуется на диск,
// 2) после consume plaintext затирается setStatus('consumed', { plaintextToken: null }),
// 3) истёкшие записи периодически чистит pruneExpired().

export type AgentDeviceCodeEntry = AgentDeviceCode & {
  readonly plaintextToken: string | null;
};

export type StoreInput = {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly expiresAt: Date;
  readonly now: Date;
};

export type ApproveInput = {
  readonly userId: string;
  readonly agentTokenId: string;
  readonly agentTokenName: string;
  readonly plaintextToken: string;
};

export interface AgentDeviceCodeStore {
  create(input: StoreInput): AgentDeviceCodeEntry;
  getByDeviceCode(deviceCode: string): AgentDeviceCodeEntry | null;
  getByUserCode(userCode: string): AgentDeviceCodeEntry | null;
  approve(userCode: string, input: ApproveInput): AgentDeviceCodeEntry | null;
  deny(userCode: string): AgentDeviceCodeEntry | null;
  consume(deviceCode: string): { entry: AgentDeviceCodeEntry; plaintextToken: string } | null;
  expire(deviceCode: string): void;
  pruneExpired(now: Date): number;
}

type MutableEntry = {
  deviceCode: string;
  userCode: string;
  status: AgentDeviceCodeStatus;
  createdAt: Date;
  expiresAt: Date;
  userId: string | null;
  agentTokenId: string | null;
  agentTokenName: string | null;
  plaintextToken: string | null;
};

function freeze(e: MutableEntry): AgentDeviceCodeEntry {
  return {
    deviceCode: e.deviceCode,
    userCode: e.userCode,
    status: e.status,
    createdAt: e.createdAt,
    expiresAt: e.expiresAt,
    userId: e.userId,
    agentTokenId: e.agentTokenId,
    agentTokenName: e.agentTokenName,
    plaintextToken: e.plaintextToken,
  };
}

export class InMemoryAgentDeviceCodeStore implements AgentDeviceCodeStore {
  private readonly byDevice = new Map<string, MutableEntry>();
  private readonly byUser = new Map<string, MutableEntry>();

  create(input: StoreInput): AgentDeviceCodeEntry {
    const entry: MutableEntry = {
      deviceCode: input.deviceCode,
      userCode: input.userCode,
      status: 'pending',
      createdAt: input.now,
      expiresAt: input.expiresAt,
      userId: null,
      agentTokenId: null,
      agentTokenName: null,
      plaintextToken: null,
    };
    this.byDevice.set(input.deviceCode, entry);
    this.byUser.set(input.userCode, entry);
    return freeze(entry);
  }

  getByDeviceCode(deviceCode: string): AgentDeviceCodeEntry | null {
    const e = this.byDevice.get(deviceCode);
    return e ? freeze(e) : null;
  }

  getByUserCode(userCode: string): AgentDeviceCodeEntry | null {
    const e = this.byUser.get(userCode);
    return e ? freeze(e) : null;
  }

  approve(userCode: string, input: ApproveInput): AgentDeviceCodeEntry | null {
    const e = this.byUser.get(userCode);
    if (!e) return null;
    e.status = 'approved';
    e.userId = input.userId;
    e.agentTokenId = input.agentTokenId;
    e.agentTokenName = input.agentTokenName;
    e.plaintextToken = input.plaintextToken;
    return freeze(e);
  }

  deny(userCode: string): AgentDeviceCodeEntry | null {
    const e = this.byUser.get(userCode);
    if (!e) return null;
    e.status = 'denied';
    return freeze(e);
  }

  consume(deviceCode: string): { entry: AgentDeviceCodeEntry; plaintextToken: string } | null {
    const e = this.byDevice.get(deviceCode);
    if (!e || e.status !== 'approved' || e.plaintextToken === null) return null;
    const plaintext = e.plaintextToken;
    e.status = 'consumed';
    e.plaintextToken = null;
    return { entry: freeze(e), plaintextToken: plaintext };
  }

  expire(deviceCode: string): void {
    const e = this.byDevice.get(deviceCode);
    if (!e) return;
    e.status = 'expired';
    e.plaintextToken = null;
  }

  pruneExpired(now: Date): number {
    let pruned = 0;
    for (const [code, e] of this.byDevice) {
      if (e.expiresAt.getTime() <= now.getTime()) {
        this.byDevice.delete(code);
        this.byUser.delete(e.userCode);
        pruned += 1;
      }
    }
    return pruned;
  }
}
