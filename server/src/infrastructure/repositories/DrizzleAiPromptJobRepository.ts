import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import type { AiPromptJob, AiPromptJobStatus } from '../../domain/ai-prompt/AiPromptJob.js';
import type {
  AiPromptJobCountByProject,
  AiPromptJobRepository,
  NewAiPromptJobInput,
  PendingAiPromptJob,
} from '../../application/ai-prompt/AiPromptJobRepository.js';
import { idGenerator } from '../id/idGenerator.js';
import { aiPromptJobs, projects, type AiPromptJobRow } from '../db/schema.js';

export class DrizzleAiPromptJobRepository implements AiPromptJobRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewAiPromptJobInput): Promise<AiPromptJob> {
    const id = idGenerator();
    await this.db.insert(aiPromptJobs).values({
      id,
      createdBy: input.createdBy,
      projectId: input.projectId,
      dispatcherUserId: input.dispatcherUserId,
      status: 'queued',
      inputText: input.inputText,
      kbContext: input.kbContext,
    });
    const row = await this.findRowById(id);
    if (!row) throw new Error(`ai_prompt_jobs row ${id} disappeared after insert`);
    return rowToJob(row);
  }

  async findById(id: string): Promise<AiPromptJob | null> {
    const row = await this.findRowById(id);
    return row ? rowToJob(row) : null;
  }

  async listPendingForDispatcher(userId: string, limit: number): Promise<PendingAiPromptJob[]> {
    // LEFT JOIN projects, потому что project_id может быть NULL (Inbox-задачи).
    const rows = await this.db
      .select({
        jobId: aiPromptJobs.id,
        projectId: aiPromptJobs.projectId,
        projectName: projects.name,
        createdAt: aiPromptJobs.createdAt,
      })
      .from(aiPromptJobs)
      .leftJoin(projects, eq(projects.id, aiPromptJobs.projectId))
      .where(
        and(eq(aiPromptJobs.dispatcherUserId, userId), eq(aiPromptJobs.status, 'queued')),
      )
      .orderBy(asc(aiPromptJobs.createdAt))
      .limit(limit);

    return rows.map((r) => ({
      id: r.jobId,
      projectId: r.projectId ?? null,
      projectName: r.projectName ?? null,
      createdAt: r.createdAt,
    }));
  }

  async countPendingByProjectForDispatcher(userId: string): Promise<AiPromptJobCountByProject> {
    // GROUP BY project_id с NULL'ами — MariaDB трактует NULL как отдельную группу.
    const rows = await this.db
      .select({
        projectId: aiPromptJobs.projectId,
        count: sql<number>`COUNT(*)`,
      })
      .from(aiPromptJobs)
      .where(
        and(eq(aiPromptJobs.dispatcherUserId, userId), eq(aiPromptJobs.status, 'queued')),
      )
      .groupBy(aiPromptJobs.projectId);

    return rows.map((r) => ({
      projectId: r.projectId ?? null,
      count: Number(r.count),
    }));
  }

  async claimById(jobId: string): Promise<AiPromptJob | null> {
    const result = await this.db
      .update(aiPromptJobs)
      .set({ status: 'running', claimedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(aiPromptJobs.id, jobId), eq(aiPromptJobs.status, 'queued')));
    const affected =
      (result as unknown as { rowsAffected?: number; affectedRows?: number }).rowsAffected ??
      (result as unknown as { affectedRows?: number }).affectedRows ??
      0;
    if (affected === 0) return null;
    return this.findById(jobId);
  }

  async complete(input: {
    id: string;
    status: Extract<AiPromptJobStatus, 'succeeded' | 'failed' | 'cancelled'>;
    improvedText: string | null;
    error: string | null;
  }): Promise<void> {
    await this.db
      .update(aiPromptJobs)
      .set({
        status: input.status,
        improvedText: input.improvedText,
        error: input.error,
        finishedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(aiPromptJobs.id, input.id));
  }

  async cancelStale(input: {
    olderThan: Date;
    reason: string;
    statuses: ReadonlyArray<Extract<AiPromptJobStatus, 'queued' | 'running'>>;
  }): Promise<number> {
    const result = await this.db
      .update(aiPromptJobs)
      .set({
        status: 'cancelled',
        error: input.reason,
        finishedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(
        and(
          inArray(aiPromptJobs.status, [...input.statuses] as AiPromptJobStatus[]),
          lt(aiPromptJobs.createdAt, input.olderThan),
        ),
      );
    return (
      (result as unknown as { rowsAffected?: number; affectedRows?: number }).rowsAffected ??
      (result as unknown as { affectedRows?: number }).affectedRows ??
      0
    );
  }

  async deleteTerminal(input: { olderThan: Date }): Promise<number> {
    const result = await this.db
      .delete(aiPromptJobs)
      .where(
        and(
          inArray(aiPromptJobs.status, ['succeeded', 'failed', 'cancelled'] as AiPromptJobStatus[]),
          lt(aiPromptJobs.createdAt, input.olderThan),
        ),
      );
    return (
      (result as unknown as { rowsAffected?: number; affectedRows?: number }).rowsAffected ??
      (result as unknown as { affectedRows?: number }).affectedRows ??
      0
    );
  }

  private async findRowById(id: string): Promise<AiPromptJobRow | undefined> {
    const [row] = await this.db
      .select()
      .from(aiPromptJobs)
      .where(eq(aiPromptJobs.id, id))
      .limit(1);
    return row;
  }
}

function rowToJob(row: AiPromptJobRow): AiPromptJob {
  return {
    id: row.id,
    createdBy: row.createdBy,
    projectId: row.projectId ?? null,
    dispatcherUserId: row.dispatcherUserId,
    status: row.status,
    inputText: row.inputText,
    kbContext: row.kbContext ?? null,
    improvedText: row.improvedText ?? null,
    error: row.error ?? null,
    claimedAt: row.claimedAt ?? null,
    finishedAt: row.finishedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

