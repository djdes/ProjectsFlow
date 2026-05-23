import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import {
  projectGitTokenAccessLog,
  projectGitTokenDelegations,
  type ProjectGitTokenAccessLogRow,
  type ProjectGitTokenDelegationRow,
} from '../db/schema.js';
import type {
  GitTokenAccessLogEntry,
  GitTokenDelegationRepository,
  LogGitTokenAccessInput,
  UpsertGitTokenDelegationInput,
} from '../../application/project/GitTokenDelegationRepository.js';
import type { GitTokenDelegation } from '../../domain/project/GitTokenDelegation.js';

function toDelegation(row: ProjectGitTokenDelegationRow): GitTokenDelegation {
  return {
    projectId: row.projectId,
    granterUserId: row.granterUserId,
    enabled: row.enabled,
    grantedAt: row.grantedAt ?? null,
    revokedAt: row.revokedAt ?? null,
  };
}

function toLogEntry(row: ProjectGitTokenAccessLogRow): GitTokenAccessLogEntry {
  return {
    accessedByUserId: row.accessedByUserId,
    granterUserId: row.granterUserId ?? null,
    accessedAt: row.accessedAt,
    outcome: row.outcome,
  };
}

export class DrizzleGitTokenDelegationRepository implements GitTokenDelegationRepository {
  constructor(
    private readonly db: Database,
    private readonly idGen: () => string,
  ) {}

  async getForMember(projectId: string, granterUserId: string): Promise<GitTokenDelegation | null> {
    const rows = await this.db
      .select()
      .from(projectGitTokenDelegations)
      .where(
        and(
          eq(projectGitTokenDelegations.projectId, projectId),
          eq(projectGitTokenDelegations.granterUserId, granterUserId),
        ),
      )
      .limit(1);
    return rows[0] ? toDelegation(rows[0]) : null;
  }

  async listEnabledForProject(projectId: string): Promise<GitTokenDelegation[]> {
    const rows = await this.db
      .select()
      .from(projectGitTokenDelegations)
      .where(
        and(
          eq(projectGitTokenDelegations.projectId, projectId),
          eq(projectGitTokenDelegations.enabled, true),
        ),
      );
    return rows.map(toDelegation);
  }

  async listAllForProject(projectId: string): Promise<GitTokenDelegation[]> {
    const rows = await this.db
      .select()
      .from(projectGitTokenDelegations)
      .where(eq(projectGitTokenDelegations.projectId, projectId));
    return rows.map(toDelegation);
  }

  async upsert(input: UpsertGitTokenDelegationInput): Promise<GitTokenDelegation> {
    const existing = await this.getForMember(input.projectId, input.granterUserId);
    const now = new Date();

    if (!existing) {
      // Первый раз. INSERT.
      await this.db.insert(projectGitTokenDelegations).values({
        projectId: input.projectId,
        granterUserId: input.granterUserId,
        enabled: input.enabled,
        // При первом включении проставляем granted_at; при «сразу enabled=false»
        // (странный кейс — выключили никогда не включённую) — оставим null.
        grantedAt: input.enabled ? now : null,
        revokedAt: input.enabled ? null : now,
      });
    } else {
      // Уже было. Обновляем enabled + grantedAt/revokedAt с правильной семантикой:
      //   enable: revoked_at -> null; granted_at оставляем историческое если уже было,
      //                                иначе ставим now.
      //   disable: revoked_at -> now; granted_at не трогаем (история).
      const patch: Partial<{
        enabled: boolean;
        grantedAt: Date | null;
        revokedAt: Date | null;
      }> = { enabled: input.enabled };
      if (input.enabled) {
        patch.revokedAt = null;
        if (!existing.grantedAt) patch.grantedAt = now;
      } else {
        patch.revokedAt = now;
      }
      await this.db
        .update(projectGitTokenDelegations)
        .set(patch)
        .where(
          and(
            eq(projectGitTokenDelegations.projectId, input.projectId),
            eq(projectGitTokenDelegations.granterUserId, input.granterUserId),
          ),
        );
    }

    const fresh = await this.getForMember(input.projectId, input.granterUserId);
    if (!fresh) throw new Error('Failed to read back git-token delegation after upsert');
    return fresh;
  }

  async logAccess(input: LogGitTokenAccessInput): Promise<void> {
    await this.db.insert(projectGitTokenAccessLog).values({
      id: this.idGen(),
      projectId: input.projectId,
      accessedByUserId: input.accessedByUserId,
      granterUserId: input.granterUserId,
      outcome: input.outcome,
    });
  }

  async listAccessLog(projectId: string, limit: number): Promise<GitTokenAccessLogEntry[]> {
    const rows = await this.db
      .select()
      .from(projectGitTokenAccessLog)
      .where(eq(projectGitTokenAccessLog.projectId, projectId))
      .orderBy(desc(projectGitTokenAccessLog.accessedAt))
      .limit(limit);
    return rows.map(toLogEntry);
  }
}
