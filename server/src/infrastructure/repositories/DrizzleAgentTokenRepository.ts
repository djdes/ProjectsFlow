import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { agentTokens, type AgentTokenRow } from '../db/schema.js';
import type { AgentToken } from '../../domain/agent/AgentToken.js';
import type {
  AgentTokenRepository,
  CreateAgentTokenInput,
} from '../../application/agent/AgentTokenRepository.js';

function toToken(row: AgentTokenRow): AgentToken {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt ?? null,
    revokedAt: row.revokedAt ?? null,
  };
}

export class DrizzleAgentTokenRepository implements AgentTokenRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateAgentTokenInput): Promise<AgentToken> {
    await this.db.insert(agentTokens).values({
      id: input.id,
      userId: input.userId,
      name: input.name,
      tokenHash: input.tokenHash,
      tokenPrefix: input.tokenPrefix,
    });
    const rows = await this.db
      .select()
      .from(agentTokens)
      .where(eq(agentTokens.id, input.id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error('Failed to read back agent token after insert');
    return toToken(row);
  }

  async listByUser(userId: string): Promise<AgentToken[]> {
    const rows = await this.db
      .select()
      .from(agentTokens)
      .where(eq(agentTokens.userId, userId))
      .orderBy(desc(agentTokens.createdAt));
    return rows.map(toToken);
  }

  async findActiveByHash(hash: string): Promise<AgentToken | null> {
    const rows = await this.db
      .select()
      .from(agentTokens)
      .where(and(eq(agentTokens.tokenHash, hash), isNull(agentTokens.revokedAt)))
      .limit(1);
    return rows[0] ? toToken(rows[0]) : null;
  }

  async revoke(id: string, userId: string): Promise<boolean> {
    const result = await this.db
      .update(agentTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(agentTokens.id, id),
          eq(agentTokens.userId, userId),
          isNull(agentTokens.revokedAt),
        ),
      );
    const affected = (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
    return affected > 0;
  }

  async touchLastUsed(id: string): Promise<void> {
    await this.db
      .update(agentTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(agentTokens.id, id));
  }
}
