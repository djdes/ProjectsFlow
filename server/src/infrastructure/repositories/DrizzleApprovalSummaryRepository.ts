import { eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { approvalSummaries } from '../db/schema.js';
import type { ApprovalSummaryRepository } from '../../application/approval-summary/ApprovalSummaryRepository.js';
import type { StoredApprovalSummary } from '../../domain/approval-summary/ApprovalSummary.js';

export class DrizzleApprovalSummaryRepository implements ApprovalSummaryRepository {
  constructor(private readonly db: Database) {}

  async find(taskId: string): Promise<StoredApprovalSummary | null> {
    const rows = await this.db
      .select()
      .from(approvalSummaries)
      .where(eq(approvalSummaries.taskId, taskId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      taskId: row.taskId,
      inputHash: row.inputHash,
      summary: row.summary,
      generatedAt: row.generatedAt,
    };
  }

  async save(summary: StoredApprovalSummary): Promise<void> {
    await this.db
      .insert(approvalSummaries)
      .values({
        taskId: summary.taskId,
        inputHash: summary.inputHash,
        summary: summary.summary,
        generatedAt: summary.generatedAt,
      })
      .onDuplicateKeyUpdate({
        set: {
          inputHash: summary.inputHash,
          summary: summary.summary,
          generatedAt: summary.generatedAt,
        },
      });
  }
}
