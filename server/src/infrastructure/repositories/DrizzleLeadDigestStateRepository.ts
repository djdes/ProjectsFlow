import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { leadDigestState, workspaceMembers } from '../db/schema.js';
import type { LeadDigestStateRepository } from '../../application/lead/LeadDigestStateRepository.js';

// Пространства с руководителями + дата последней сводки. Список пространств выводится из
// самих ролей (нет отдельной «подписки»): назначили руководителя — сводка появилась,
// сняли роль — исчезла.
export class DrizzleLeadDigestStateRepository implements LeadDigestStateRepository {
  constructor(private readonly db: Database) {}

  async listWorkspacesWithLeads(): Promise<
    ReadonlyArray<{ workspaceId: string; lastSentOn: string | null }>
  > {
    const rows = await this.db
      .selectDistinct({
        workspaceId: workspaceMembers.workspaceId,
        // DATE → строка YYYY-MM-DD: сравниваем с датой планировщика как строку.
        lastSentOn: sql<string | null>`DATE_FORMAT(${leadDigestState.lastSentOn}, '%Y-%m-%d')`,
      })
      .from(workspaceMembers)
      .leftJoin(leadDigestState, eq(leadDigestState.workspaceId, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.role, 'lead'));
    return rows.map((r) => ({ workspaceId: r.workspaceId, lastSentOn: r.lastSentOn ?? null }));
  }

  async markSent(workspaceId: string, dateMsk: string): Promise<void> {
    await this.db
      .insert(leadDigestState)
      .values({ workspaceId, lastSentOn: dateMsk })
      // MariaDB: только VALUES(col), без `AS new` (см. CLAUDE.md, миграции).
      .onDuplicateKeyUpdate({ set: { lastSentOn: dateMsk } });
  }
}
