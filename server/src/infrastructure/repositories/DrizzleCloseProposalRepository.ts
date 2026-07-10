import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import type { CloseProposal } from '../../domain/close-proposal/CloseProposal.js';
import type {
  CloseProposalRepository,
  NewCloseProposalInput,
} from '../../application/close-proposal/CloseProposalRepository.js';
import { idGenerator } from '../id/idGenerator.js';
import { taskCloseProposals, type TaskCloseProposalRow } from '../db/schema.js';

export class DrizzleCloseProposalRepository implements CloseProposalRepository {
  constructor(private readonly db: Database) {}

  async create(
    input: NewCloseProposalInput,
  ): Promise<{ proposal: CloseProposal; created: boolean }> {
    // Идемпотентность по UNIQUE(task_id, commit_sha): не дублируем и не «воскрешаем» dismissed.
    const existing = await this.findByTaskCommit(input.taskId, input.commitSha);
    if (existing) return { proposal: existing, created: false };

    const id = idGenerator();
    try {
      await this.db.insert(taskCloseProposals).values({
        id,
        projectId: input.projectId,
        taskId: input.taskId,
        commitSha: input.commitSha,
        reason: input.reason,
        sourceJobId: input.sourceJobId,
        status: 'open',
      });
    } catch (e) {
      // Гонка на UNIQUE — другой прогон успел вставить; вернём существующее.
      const again = await this.findByTaskCommit(input.taskId, input.commitSha);
      if (again) return { proposal: again, created: false };
      throw e;
    }

    const row = await this.findRowById(id);
    if (!row) throw new Error(`task_close_proposals row ${id} disappeared after insert`);
    return { proposal: rowToProposal(row), created: true };
  }

  async findById(id: string): Promise<CloseProposal | null> {
    const row = await this.findRowById(id);
    return row ? rowToProposal(row) : null;
  }

  async listOpenByProject(projectId: string): Promise<CloseProposal[]> {
    const rows = await this.db
      .select()
      .from(taskCloseProposals)
      .where(
        and(
          eq(taskCloseProposals.projectId, projectId),
          eq(taskCloseProposals.status, 'open'),
        ),
      )
      .orderBy(desc(taskCloseProposals.createdAt));
    return rows.map(rowToProposal);
  }

  async resolve(input: {
    id: string;
    status: 'confirmed' | 'dismissed' | 'expired';
    resolvedBy: string | null;
  }): Promise<CloseProposal | null> {
    const result = await this.db
      .update(taskCloseProposals)
      .set({
        status: input.status,
        resolvedBy: input.resolvedBy,
        resolvedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(
        and(eq(taskCloseProposals.id, input.id), eq(taskCloseProposals.status, 'open')),
      );
    const affected = (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
    if (affected === 0) return null;
    return this.findById(input.id);
  }

  private async findByTaskCommit(
    taskId: string,
    commitSha: string,
  ): Promise<CloseProposal | null> {
    const [row] = await this.db
      .select()
      .from(taskCloseProposals)
      .where(
        and(
          eq(taskCloseProposals.taskId, taskId),
          eq(taskCloseProposals.commitSha, commitSha),
        ),
      )
      .limit(1);
    return row ? rowToProposal(row) : null;
  }

  private async findRowById(id: string): Promise<TaskCloseProposalRow | undefined> {
    const [row] = await this.db
      .select()
      .from(taskCloseProposals)
      .where(eq(taskCloseProposals.id, id))
      .limit(1);
    return row;
  }
}

function rowToProposal(row: TaskCloseProposalRow): CloseProposal {
  return {
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    commitSha: row.commitSha,
    reason: row.reason ?? null,
    sourceJobId: row.sourceJobId ?? null,
    status: row.status,
    resolvedBy: row.resolvedBy ?? null,
    resolvedAt: row.resolvedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
