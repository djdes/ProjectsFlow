import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
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
    scopeKind: row.scopeKind,
    projectId: row.projectId ?? null,
    taskId: row.taskId ?? null,
    parentTokenId: row.parentTokenId ?? null,
    expiresAt: row.expiresAt ?? null,
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
      scopeKind: input.scopeKind ?? 'account',
      projectId: input.projectId ?? null,
      taskId: input.taskId ?? null,
      parentTokenId: input.parentTokenId ?? null,
      expiresAt: input.expiresAt ?? null,
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
      .where(and(eq(agentTokens.userId, userId), eq(agentTokens.scopeKind, 'account')))
      .orderBy(desc(agentTokens.createdAt));
    return rows.map(toToken);
  }

  async findActiveByHash(hash: string): Promise<AgentToken | null> {
    const rows = await this.db
      .select()
      .from(agentTokens)
      .where(
        and(
          eq(agentTokens.tokenHash, hash),
          isNull(agentTokens.revokedAt),
          or(isNull(agentTokens.expiresAt), gt(agentTokens.expiresAt, new Date())),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;

    // Child capabilities never outlive their dispatcher credential. This also
    // closes the race where a request authenticated with an account token just
    // before it was revoked and managed to create a child immediately after.
    if (row.scopeKind === 'project') {
      if (!row.parentTokenId) return null;
      const parents = await this.db
        .select({ id: agentTokens.id })
        .from(agentTokens)
        .where(
          and(
            eq(agentTokens.id, row.parentTokenId),
            eq(agentTokens.userId, row.userId),
            eq(agentTokens.scopeKind, 'account'),
            isNull(agentTokens.revokedAt),
          ),
        )
        .limit(1);
      if (!parents[0]) return null;
    }
    return toToken(row);
  }

  async revoke(id: string, userId: string): Promise<boolean> {
    const result = await this.db
      .update(agentTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(agentTokens.userId, userId),
          isNull(agentTokens.revokedAt),
          or(
            and(eq(agentTokens.id, id), eq(agentTokens.scopeKind, 'account')),
            and(
              eq(agentTokens.parentTokenId, id),
              eq(agentTokens.scopeKind, 'project'),
            ),
          ),
        ),
      );
    const affected = (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
    return affected > 0;
  }

  async revokeProjectCapability(
    id: string,
    userId: string,
    parentTokenId: string,
  ): Promise<boolean> {
    const result = await this.db
      .update(agentTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(agentTokens.id, id),
          eq(agentTokens.userId, userId),
          eq(agentTokens.scopeKind, 'project'),
          eq(agentTokens.parentTokenId, parentTokenId),
          isNull(agentTokens.revokedAt),
        ),
      );
    const affected = (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
    return affected > 0;
  }

  async listActiveProjectCapabilities(projectId: string): Promise<AgentToken[]> {
    const rows = await this.db
      .select()
      .from(agentTokens)
      .where(
        and(
          eq(agentTokens.scopeKind, 'project'),
          eq(agentTokens.projectId, projectId),
          isNull(agentTokens.revokedAt),
          or(isNull(agentTokens.expiresAt), gt(agentTokens.expiresAt, new Date())),
        ),
      )
      .orderBy(desc(agentTokens.createdAt));
    return rows.map(toToken);
  }

  async touchLastUsed(id: string): Promise<void> {
    await this.db
      .update(agentTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(agentTokens.id, id));
  }

  async countActiveByUser(userId: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(agentTokens)
      .where(
        and(
          eq(agentTokens.userId, userId),
          eq(agentTokens.scopeKind, 'account'),
          isNull(agentTokens.revokedAt),
        ),
      );
    return Number(rows[0]?.count ?? 0);
  }
}
