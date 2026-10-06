// Тестовые двойники модуля llm (используются только в *.test.ts).
import {
  llmOwnerKey,
  type LlmConnection,
  type LlmConnectionOwner,
  type LlmConnectionStatus,
  type LlmCredentials,
  type LlmProvider,
} from '../../domain/llm/LlmConnection.js';
import type { LlmDeviceLogin } from '../../domain/llm/LlmDeviceLogin.js';
import type {
  LlmConnectionRepository,
  SaveLlmConnectionInput,
  UpdateLlmTokensInput,
} from './LlmConnectionRepository.js';
import type { LlmDeviceLoginRepository, NewLlmDeviceLoginInput } from './LlmDeviceLoginRepository.js';
import type { LlmSettingsRepository, StoredLlmSettings } from './LlmSettingsRepository.js';

type Stored = { connection: LlmConnection; credentials: LlmCredentials };

export class InMemoryLlmConnections implements LlmConnectionRepository {
  readonly rows = new Map<string, Stored>();
  updateTokensCalls = 0;
  private seq = 0;

  seed(input: {
    owner?: LlmConnectionOwner;
    status?: LlmConnectionStatus;
    accessToken?: string;
    refreshToken?: string | null;
    accessExpiresAt?: Date | null;
    rateLimitedUntil?: Date | null;
  }): LlmConnection {
    const id = `conn-${++this.seq}`;
    const now = new Date('2026-10-06T10:00:00Z');
    const connection: LlmConnection = {
      id,
      owner: input.owner ?? { scope: 'platform' },
      provider: 'chatgpt',
      status: input.status ?? 'active',
      accountId: 'acc_1',
      accountEmail: 'owner@example.com',
      planType: 'plus',
      accessExpiresAt: input.accessExpiresAt === undefined ? new Date('2026-10-16T10:00:00Z') : input.accessExpiresAt,
      lastRefreshAt: now,
      rateLimitedUntil: input.rateLimitedUntil ?? null,
      lastError: null,
      lastUsedAt: null,
      version: 0,
      createdBy: 'admin',
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(id, {
      connection,
      credentials: {
        accessToken: input.accessToken ?? 'access-1',
        refreshToken: input.refreshToken === undefined ? 'refresh-1' : input.refreshToken,
        idToken: null,
      },
    });
    return connection;
  }

  async findByOwner(owner: LlmConnectionOwner, provider: LlmProvider): Promise<LlmConnection | null> {
    for (const { connection } of this.rows.values()) {
      if (llmOwnerKey(connection.owner) === llmOwnerKey(owner) && connection.provider === provider) return connection;
    }
    return null;
  }

  async findById(id: string): Promise<LlmConnection | null> {
    return this.rows.get(id)?.connection ?? null;
  }

  async getCredentials(id: string): Promise<LlmCredentials | null> {
    return this.rows.get(id)?.credentials ?? null;
  }

  async upsert(input: SaveLlmConnectionInput): Promise<LlmConnection> {
    const existing = await this.findByOwner(input.owner, input.provider);
    const base = existing ?? this.seed({ owner: input.owner });
    const connection: LlmConnection = {
      ...base,
      status: 'active',
      accountId: input.account.accountId,
      accountEmail: input.account.email,
      planType: input.account.planType,
      accessExpiresAt: input.account.accessExpiresAt,
      version: base.version + 1,
      createdBy: input.createdBy,
    };
    this.rows.set(base.id, { connection, credentials: input.credentials });
    return connection;
  }

  async updateTokens(input: UpdateLlmTokensInput): Promise<boolean> {
    this.updateTokensCalls++;
    const row = this.rows.get(input.id);
    if (!row || row.connection.version !== input.expectedVersion) return false;
    this.rows.set(input.id, {
      connection: {
        ...row.connection,
        accountId: input.account.accountId,
        accessExpiresAt: input.account.accessExpiresAt,
        lastRefreshAt: input.refreshedAt,
        status: 'active',
        version: row.connection.version + 1,
      },
      credentials: input.credentials,
    });
    return true;
  }

  async markStatus(id: string, status: LlmConnectionStatus, lastError: string | null): Promise<void> {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, connection: { ...row.connection, status, lastError } });
  }

  async markRateLimited(id: string, until: Date | null, lastError: string | null): Promise<void> {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, connection: { ...row.connection, rateLimitedUntil: until, lastError } });
  }

  async touchUsed(id: string, at: Date): Promise<void> {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, connection: { ...row.connection, lastUsedAt: at } });
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}

export class InMemoryLlmDeviceLogins implements LlmDeviceLoginRepository {
  readonly rows = new Map<string, LlmDeviceLogin>();

  async find(owner: LlmConnectionOwner, provider: LlmProvider): Promise<LlmDeviceLogin | null> {
    return this.rows.get(`${llmOwnerKey(owner)}:${provider}`) ?? null;
  }

  async replace(input: NewLlmDeviceLoginInput): Promise<LlmDeviceLogin> {
    const login: LlmDeviceLogin = { ...input, id: `login-${this.rows.size + 1}`, createdAt: new Date() };
    this.rows.set(`${llmOwnerKey(input.owner)}:${input.provider}`, login);
    return login;
  }

  async delete(owner: LlmConnectionOwner, provider: LlmProvider): Promise<void> {
    this.rows.delete(`${llmOwnerKey(owner)}:${provider}`);
  }
}

export class InMemoryLlmSettings implements LlmSettingsRepository {
  value: StoredLlmSettings = { defaultModel: null, fastModel: null, serverQueues: [], updatedAt: null };

  async get(): Promise<StoredLlmSettings> {
    return this.value;
  }

  async save(input: Parameters<LlmSettingsRepository['save']>[0]): Promise<void> {
    this.value = {
      defaultModel: input.defaultModel,
      fastModel: input.fastModel,
      serverQueues: input.serverQueues,
      updatedAt: new Date(),
    };
  }
}
