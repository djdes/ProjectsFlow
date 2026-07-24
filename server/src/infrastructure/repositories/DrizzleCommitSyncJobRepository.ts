import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import type { CommitSyncJob, CommitSyncStatus } from '../../domain/commit-sync/CommitSyncJob.js';
import type {
  CommitSyncBatchStatus,
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
      batchKey: input.batchKey,
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
    reviewJson: string | null;
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
        reviewJson: input.reviewJson,
        resultSummary: input.resultSummary,
        error: input.error,
        costUsd: input.costUsd === null ? null : String(input.costUsd),
        tokensIn: input.tokensIn,
        tokensOut: input.tokensOut,
        finishedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(commitSyncJobs.id, input.id));
  }

  async listByBatchKey(batchKey: string): Promise<CommitSyncJob[]> {
    const rows = await this.db
      .select()
      .from(commitSyncJobs)
      .where(eq(commitSyncJobs.batchKey, batchKey));
    return rows.map(rowToJob);
  }

  async listBatchStatuses(batchKey: string): Promise<CommitSyncBatchStatus[]> {
    const rows = await this.db
      .select({
        projectId: commitSyncJobs.projectId,
        projectName: projects.name,
        status: commitSyncJobs.status,
        createdAt: commitSyncJobs.createdAt,
      })
      .from(commitSyncJobs)
      .leftJoin(projects, eq(projects.id, commitSyncJobs.projectId))
      .where(eq(commitSyncJobs.batchKey, batchKey))
      .orderBy(asc(commitSyncJobs.createdAt));
    return rows.map((r) => ({
      projectId: r.projectId,
      projectName: r.projectName ?? null,
      status: r.status,
    }));
  }

  async tryMarkBatchFlushed(batchKey: string): Promise<boolean> {
    // Один атомарный UPDATE гасит все строки батча, но только если не осталось незавершённых
    // job'ов и флаг ещё NULL. Параллельные завершения: второй увидит batch_flushed_at NOT NULL
    // (InnoDB перечитывает строку под блокировкой) → 0 строк. Derived-table обёртка обходит
    // запрет MySQL на подзапрос к обновляемой таблице.
    const result = await this.db.execute(sql`
      UPDATE commit_sync_jobs
      SET batch_flushed_at = CURRENT_TIMESTAMP
      WHERE batch_key = ${batchKey}
        AND batch_flushed_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM (SELECT status FROM commit_sync_jobs WHERE batch_key = ${batchKey}) s
          WHERE s.status IN ('queued', 'running')
        )
    `);
    return affectedRows(result) > 0;
  }

  async tryMarkJobFlushed(jobId: string): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE commit_sync_jobs
      SET batch_flushed_at = CURRENT_TIMESTAMP
      WHERE id = ${jobId}
        AND batch_flushed_at IS NULL
        AND status NOT IN ('queued', 'running')
    `);
    return affectedRows(result) > 0;
  }

  async findFlushableBatchKeys(): Promise<string[]> {
    const result = await this.db.execute(sql`
      SELECT batch_key AS batchKey FROM commit_sync_jobs
      WHERE batch_key IS NOT NULL
      GROUP BY batch_key
      HAVING SUM(status IN ('queued', 'running')) = 0
         AND SUM(batch_flushed_at IS NOT NULL) = 0
    `);
    const rows = (result as unknown as [Array<{ batchKey: string }>])[0] ?? [];
    return rows.map((r) => r.batchKey).filter((key): key is string => typeof key === 'string');
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

// mysql2 возвращает [ResultSetHeader, FieldPacket[]] для UPDATE — читаем affectedRows.
function affectedRows(result: unknown): number {
  return (result as [{ affectedRows?: number }])[0]?.affectedRows ?? 0;
}

function rowToJob(row: CommitSyncJobRow): CommitSyncJob {
  return {
    id: row.id,
    projectId: row.projectId,
    createdBy: row.createdBy ?? null,
    dispatcherUserId: row.dispatcherUserId,
    status: row.status,
    action: row.action,
    batchKey: row.batchKey ?? null,
    thresholdHours: row.thresholdHours,
    context: row.context ?? null,
    commitsJson: row.commitsJson ?? null,
    matchesJson: row.matchesJson ?? null,
    reviewJson: row.reviewJson ?? null,
    resultSummary: row.resultSummary ?? null,
    error: row.error ?? null,
    // DECIMAL приходит строкой из mysql2 → Number(); BIGINT(mode:number) уже число.
    costUsd: row.costUsd === null || row.costUsd === undefined ? null : Number(row.costUsd),
    tokensIn: row.tokensIn ?? null,
    tokensOut: row.tokensOut ?? null,
    claimedAt: row.claimedAt ?? null,
    finishedAt: row.finishedAt ?? null,
    batchFlushedAt: row.batchFlushedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
