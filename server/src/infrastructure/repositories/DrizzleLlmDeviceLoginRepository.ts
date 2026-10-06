import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import {
  llmOwnerKey,
  type LlmConnectionOwner,
  type LlmProvider,
} from '../../domain/llm/LlmConnection.js';
import type { LlmDeviceLogin } from '../../domain/llm/LlmDeviceLogin.js';
import type {
  LlmDeviceLoginRepository,
  NewLlmDeviceLoginInput,
} from '../../application/llm/LlmDeviceLoginRepository.js';
import { idGenerator } from '../id/idGenerator.js';
import { llmDeviceLogins, type LlmDeviceLoginRow } from '../db/schema.js';

export class DrizzleLlmDeviceLoginRepository implements LlmDeviceLoginRepository {
  constructor(private readonly db: Database) {}

  async find(owner: LlmConnectionOwner, provider: LlmProvider): Promise<LlmDeviceLogin | null> {
    const rows = await this.db
      .select()
      .from(llmDeviceLogins)
      .where(and(eq(llmDeviceLogins.ownerKey, llmOwnerKey(owner)), eq(llmDeviceLogins.provider, provider)))
      .limit(1);
    return rows[0] ? rowToLogin(rows[0]) : null;
  }

  async replace(input: NewLlmDeviceLoginInput): Promise<LlmDeviceLogin> {
    await this.delete(input.owner, input.provider);
    const id = idGenerator();
    await this.db.insert(llmDeviceLogins).values({
      id,
      scope: input.owner.scope,
      ownerUserId: input.owner.scope === 'user' ? input.owner.userId : null,
      ownerKey: llmOwnerKey(input.owner),
      provider: input.provider,
      userCode: input.userCode,
      deviceAuthId: input.deviceAuthId,
      verificationUrl: input.verificationUrl,
      intervalSec: input.intervalSec,
      expiresAt: input.expiresAt,
      createdBy: input.createdBy,
    });
    const created = await this.find(input.owner, input.provider);
    if (!created) throw new Error(`llm_device_logins row ${id} disappeared after insert`);
    return created;
  }

  async delete(owner: LlmConnectionOwner, provider: LlmProvider): Promise<void> {
    await this.db
      .delete(llmDeviceLogins)
      .where(and(eq(llmDeviceLogins.ownerKey, llmOwnerKey(owner)), eq(llmDeviceLogins.provider, provider)));
  }
}

function rowToLogin(row: LlmDeviceLoginRow): LlmDeviceLogin {
  const owner: LlmConnectionOwner =
    row.scope === 'user' && row.ownerUserId ? { scope: 'user', userId: row.ownerUserId } : { scope: 'platform' };
  return {
    id: row.id,
    owner,
    provider: row.provider as LlmProvider,
    userCode: row.userCode,
    deviceAuthId: row.deviceAuthId,
    verificationUrl: row.verificationUrl,
    intervalSec: Number(row.intervalSec),
    expiresAt: row.expiresAt,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}
