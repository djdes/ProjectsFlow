import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import {
  llmOwnerKey,
  type LlmConnection,
  type LlmConnectionOwner,
  type LlmConnectionStatus,
  type LlmCredentials,
  type LlmProvider,
} from '../../domain/llm/LlmConnection.js';
import type {
  LlmConnectionRepository,
  SaveLlmConnectionInput,
  UpdateLlmTokensInput,
} from '../../application/llm/LlmConnectionRepository.js';
import { idGenerator } from '../id/idGenerator.js';
import type { TokenCipher } from '../llm/TokenCipher.js';
import { llmConnections, type LlmConnectionRow } from '../db/schema.js';

function affectedRows(result: unknown): number {
  // Drizzle mysql2 возвращает [ResultSetHeader, FieldPacket[]] для UPDATE/DELETE.
  return (result as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
}

function isDuplicate(e: unknown): boolean {
  const err = e as { code?: string; errno?: number; cause?: { code?: string; errno?: number } };
  return (
    err?.code === 'ER_DUP_ENTRY' ||
    err?.errno === 1062 ||
    err?.cause?.code === 'ER_DUP_ENTRY' ||
    err?.cause?.errno === 1062
  );
}

export class DrizzleLlmConnectionRepository implements LlmConnectionRepository {
  constructor(
    private readonly db: Database,
    private readonly cipher: TokenCipher,
  ) {}

  async findByOwner(owner: LlmConnectionOwner, provider: LlmProvider): Promise<LlmConnection | null> {
    const rows = await this.db
      .select()
      .from(llmConnections)
      .where(and(eq(llmConnections.ownerKey, llmOwnerKey(owner)), eq(llmConnections.provider, provider)))
      .limit(1);
    return rows[0] ? rowToConnection(rows[0]) : null;
  }

  async findById(id: string): Promise<LlmConnection | null> {
    const row = await this.findRow(id);
    return row ? rowToConnection(row) : null;
  }

  async getCredentials(id: string): Promise<LlmCredentials | null> {
    const row = await this.findRow(id);
    if (!row) return null;
    const accessToken = this.cipher.decrypt(row.accessToken);
    if (!accessToken) return null;
    const refreshToken = row.refreshToken ? this.cipher.decrypt(row.refreshToken) : null;
    if (row.refreshToken && refreshToken === null) return null;
    const idToken = row.idToken ? this.cipher.decrypt(row.idToken) : null;
    return { accessToken, refreshToken, idToken };
  }

  async upsert(input: SaveLlmConnectionInput): Promise<LlmConnection> {
    const values = {
      status: 'active' as const,
      accountId: input.account.accountId,
      accountEmail: input.account.email,
      planType: input.account.planType,
      accessToken: this.cipher.encrypt(input.credentials.accessToken),
      refreshToken: input.credentials.refreshToken ? this.cipher.encrypt(input.credentials.refreshToken) : null,
      idToken: input.credentials.idToken ? this.cipher.encrypt(input.credentials.idToken) : null,
      accessExpiresAt: input.account.accessExpiresAt,
      lastRefreshAt: new Date(),
      rateLimitedUntil: null,
      lastError: null,
      createdBy: input.createdBy,
    };
    const ownerKey = llmOwnerKey(input.owner);
    const existing = await this.findByOwner(input.owner, input.provider);
    if (existing) {
      await this.db
        .update(llmConnections)
        .set({ ...values, version: sql`${llmConnections.version} + 1` })
        .where(eq(llmConnections.id, existing.id));
      return (await this.findById(existing.id))!;
    }
    const id = idGenerator();
    try {
      await this.db.insert(llmConnections).values({
        id,
        scope: input.owner.scope,
        ownerUserId: input.owner.scope === 'user' ? input.owner.userId : null,
        ownerKey,
        provider: input.provider,
        ...values,
      });
    } catch (e) {
      // Параллельный вход того же владельца успел вставить строку — обновляем её.
      if (!isDuplicate(e)) throw e;
      return this.upsert(input);
    }
    const created = await this.findById(id);
    if (!created) throw new Error(`llm_connections row ${id} disappeared after insert`);
    return created;
  }

  async updateTokens(input: UpdateLlmTokensInput): Promise<boolean> {
    const result = await this.db
      .update(llmConnections)
      .set({
        accessToken: this.cipher.encrypt(input.credentials.accessToken),
        refreshToken: input.credentials.refreshToken ? this.cipher.encrypt(input.credentials.refreshToken) : null,
        idToken: input.credentials.idToken ? this.cipher.encrypt(input.credentials.idToken) : null,
        accountId: input.account.accountId,
        accountEmail: input.account.email,
        planType: input.account.planType,
        accessExpiresAt: input.account.accessExpiresAt,
        lastRefreshAt: input.refreshedAt,
        status: 'active',
        lastError: null,
        version: sql`${llmConnections.version} + 1`,
      })
      .where(and(eq(llmConnections.id, input.id), eq(llmConnections.version, input.expectedVersion)));
    return affectedRows(result) > 0;
  }

  async markStatus(id: string, status: LlmConnectionStatus, lastError: string | null): Promise<void> {
    await this.db
      .update(llmConnections)
      .set({ status, lastError: lastError ? lastError.slice(0, 500) : null })
      .where(eq(llmConnections.id, id));
  }

  async markRateLimited(id: string, until: Date | null, lastError: string | null): Promise<void> {
    await this.db
      .update(llmConnections)
      .set({ rateLimitedUntil: until, lastError: lastError ? lastError.slice(0, 500) : null })
      .where(eq(llmConnections.id, id));
  }

  async touchUsed(id: string, at: Date): Promise<void> {
    await this.db.update(llmConnections).set({ lastUsedAt: at }).where(eq(llmConnections.id, id));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(llmConnections).where(eq(llmConnections.id, id));
  }

  private async findRow(id: string): Promise<LlmConnectionRow | null> {
    const rows = await this.db.select().from(llmConnections).where(eq(llmConnections.id, id)).limit(1);
    return rows[0] ?? null;
  }
}

function rowToConnection(row: LlmConnectionRow): LlmConnection {
  const owner: LlmConnectionOwner =
    row.scope === 'user' && row.ownerUserId ? { scope: 'user', userId: row.ownerUserId } : { scope: 'platform' };
  return {
    id: row.id,
    owner,
    provider: row.provider as LlmProvider,
    status: row.status,
    accountId: row.accountId ?? null,
    accountEmail: row.accountEmail ?? null,
    planType: row.planType ?? null,
    accessExpiresAt: row.accessExpiresAt ?? null,
    lastRefreshAt: row.lastRefreshAt ?? null,
    rateLimitedUntil: row.rateLimitedUntil ?? null,
    lastError: row.lastError ?? null,
    lastUsedAt: row.lastUsedAt ?? null,
    version: Number(row.version),
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
