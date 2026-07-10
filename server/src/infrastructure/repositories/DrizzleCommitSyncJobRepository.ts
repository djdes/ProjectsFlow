import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import type { CommitSyncJob, CommitSyncStatus } from '../../domain/commit-sync/CommitSyncJob.js';
import type {
  CommitSyncJobRepository,
  NewCommitSyncJobInput,
  PendingCommitSyncJob,
} from '../../application/commit-sync/CommitSyncJobRepository.js';
import { idGenerator } from '../id/idGenerator.js';
import { commitSyncJobs, projects, type CommitSyncJobRow } from '../db/schema.js';

export class DrizzleCommitSyncJobRepository implements CommitSyncJobRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewCommitSyncJobInput): Promise<CommitSyncJob> {
    const id = idGenerator();
    await this.db.insert(commitSyncJobs).values({
      id,
      projectId: input.projectId,
      createdBy: input.createdBy,
      dispatcherUserId: input.dispatcherUserId,
      status: 'queued',
      action: input.action,
      thresholdHours: input.thresholdHours,
      context: input.context,
      commitsJson: input.commitsJson,
    });
    const row = await this.findRowById(id);
    if (!row) throw new Error(`commit_sync_jobs row ${id} disappeared after insert`);
    return rowToJob(row);
  }

  async findById(id: string): Promise<CommitSyncJob | null> {
    const row = await this.findRowById(id);
    return row ? rowToJob(row) : null;
  }

  async listPendingForDispatcher(userId: string, limit: number): Promise<PendingCommitSyncJob[]> {
    const rows = await this.db
      .select({
        jobId: commitSyncJobs.id,
        projectId: commitSyncJobs.projectId,
        projectName: projects.name,
        createdAt: commitSyncJobs.createdAt,
      })
      .from(commitSyncJobs)
      .leftJoin(projects, eq(projects.id, commitSyncJobs.projectId))
      .where(
        and(eq(commitSyncJobs.dispatcherUserId, userId), eq(commitSyncJobs.status, 'queued')),
      )
      .orderBy(asc(commitSyncJobs.createdAt))
      .limit(limit);

    return rows.map((r) => ({
      id: r.jobId,
      projectId: r.projectId,
      projectName: r.projectName ?? null,
      createdAt: r.createdAt,
    }));
  }

  async existsActiveForProject(projectId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: commitSyncJobs.id })
      .from(commitSyncJobs)
      .where(
        and(
          eq(commitSyncJobs.projectId, projectId),
          inArray(commitSyncJobs.status, ['queued', 'running'] as CommitSyncStatus[]),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async claimById(jobId: string): Promise<CommitSyncJob | null> {
    const result = await this.db
      .update(commitSyncJobs)
      .set({ status: 'running', claimedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(commitSyncJobs.id, jobId), eq(commitSyncJobs.status, 'queued')));
    const affected = (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
    if (affected === 0) return null;
    return this.findById(jobId);
  }

  async complete(input: {
    id: string;
    status: Extract<CommitSyncStatus, 'succeeded' | 'failed' | 'cancelled'>;
    matchesJson: string | null;
    resultSummary: string | null;
    error: string | null;
    costUsd: number | null;
    tokensIn: number | null;
    tokensOut: number | null;
  }): Promise<void> {
    await this.db
      .update(commitSyncJobs)
      .set({
        status: input.status,
        matchesJson: input.matchesJson,
        resultSummary: input.resultSummary,
        error: input.error,
        costUsd: input.costUsd === null ? null : String(input.costUsd),
        tokensIn: input.tokensIn,
        tokensOut: input.tokensOut,
        finishedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(commitSyncJobs.id, input.id));
  }

  async cancelStale(input: {
    olderThan: Date;
    statuses: ReadonlyArray<Extract<CommitSyncStatus, 'queued' | 'running'>>;
  }): Promise<number> {
    const result = await this.db
      .update(commitSyncJobs)
      .set({ status: 'cancelled', error: 'dispatcher_timeout', finishedAt: sql`CURRENT_TIMESTAMP` })
      .where(
        and(
          inArray(commitSyncJobs.status, [...input.statuses] as CommitSyncStatus[]),
          lt(commitSyncJobs.createdAt, input.olderThan),
        ),
      );
    return (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
  }

  async deleteTerminal(input: { olderThan: Date }): Promise<number> {
    const result = await this.db
      .delete(commitSyncJobs)
      .where(
        and(
          inArray(commitSyncJobs.status, ['succeeded', 'failed', 'cancelled'] as CommitSyncStatus[]),
          lt(commitSyncJobs.createdAt, input.olderThan),
        ),
      );
    return (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
  }

  private async findRowById(id: string): Promise<CommitSyncJobRow | undefined> {
    const [row] = await this.db
      .select()
      .from(commitSyncJobs)
      .where(eq(commitSyncJobs.id, id))
      .limit(1);
    return row;
  }
}

function rowToJob(row: CommitSyncJobRow): CommitSyncJob {
  return {
    id: row.id,
    projectId: row.projectId,
    createdBy: row.createdBy ?? null,
    dispatcherUserId: row.dispatcherUserId,
    status: row.status,
    action: row.action,
    thresholdHours: row.thresholdHours,
    context: row.context ?? null,
    commitsJson: row.commitsJson ?? null,
    matchesJson: row.matchesJson ?? null,
    resultSummary: row.resultSummary ?? null,
    error: row.error ?? null,
    // DECIMAL приходит строкой из mysql2 → Number(); BIGINT(mode:number) уже число.
    costUsd: row.costUsd === null || row.costUsd === undefined ? null : Number(row.costUsd),
    tokensIn: row.tokensIn ?? null,
    tokensOut: row.tokensOut ?? null,
    claimedAt: row.claimedAt ?? null,
    finishedAt: row.finishedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
