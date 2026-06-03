import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import type {
  MonitoringAnalysisJob,
  MonitoringAnalysisStatus,
} from '../../domain/monitoring-analysis/MonitoringAnalysisJob.js';
import type {
  MonitoringAnalysisJobRepository,
  NewMonitoringAnalysisJobInput,
  PendingMonitoringAnalysisJob,
} from '../../application/monitoring-analysis/MonitoringAnalysisJobRepository.js';
import { idGenerator } from '../id/idGenerator.js';
import {
  monitoringAnalysisJobs,
  projects,
  projectServers,
  type MonitoringAnalysisJobRow,
} from '../db/schema.js';

export class DrizzleMonitoringAnalysisJobRepository implements MonitoringAnalysisJobRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewMonitoringAnalysisJobInput): Promise<MonitoringAnalysisJob> {
    const id = idGenerator();
    await this.db.insert(monitoringAnalysisJobs).values({
      id,
      createdBy: input.createdBy,
      projectId: input.projectId,
      serverId: input.serverId,
      dispatcherUserId: input.dispatcherUserId,
      status: 'queued',
      analysisType: input.analysisType,
      alertId: input.alertId,
      context: input.context,
      note: input.note,
    });
    const row = await this.findRowById(id);
    if (!row) throw new Error(`monitoring_analysis_jobs row ${id} disappeared after insert`);
    return rowToJob(row);
  }

  async findById(id: string): Promise<MonitoringAnalysisJob | null> {
    const row = await this.findRowById(id);
    return row ? rowToJob(row) : null;
  }

  async listPendingForDispatcher(userId: string, limit: number): Promise<PendingMonitoringAnalysisJob[]> {
    const rows = await this.db
      .select({
        jobId: monitoringAnalysisJobs.id,
        projectId: monitoringAnalysisJobs.projectId,
        projectName: projects.name,
        serverId: monitoringAnalysisJobs.serverId,
        serverName: projectServers.name,
        analysisType: monitoringAnalysisJobs.analysisType,
        createdAt: monitoringAnalysisJobs.createdAt,
      })
      .from(monitoringAnalysisJobs)
      .leftJoin(projects, eq(projects.id, monitoringAnalysisJobs.projectId))
      .leftJoin(projectServers, eq(projectServers.id, monitoringAnalysisJobs.serverId))
      .where(
        and(
          eq(monitoringAnalysisJobs.dispatcherUserId, userId),
          eq(monitoringAnalysisJobs.status, 'queued'),
        ),
      )
      .orderBy(asc(monitoringAnalysisJobs.createdAt))
      .limit(limit);

    return rows.map((r) => ({
      id: r.jobId,
      projectId: r.projectId,
      projectName: r.projectName ?? null,
      serverId: r.serverId,
      serverName: r.serverName ?? null,
      analysisType: r.analysisType,
      createdAt: r.createdAt,
    }));
  }

  async listByServer(serverId: string, limit: number): Promise<MonitoringAnalysisJob[]> {
    const rows = await this.db
      .select()
      .from(monitoringAnalysisJobs)
      .where(eq(monitoringAnalysisJobs.serverId, serverId))
      .orderBy(desc(monitoringAnalysisJobs.createdAt))
      .limit(limit);
    return rows.map(rowToJob);
  }

  async existsForAlert(alertId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: monitoringAnalysisJobs.id })
      .from(monitoringAnalysisJobs)
      .where(eq(monitoringAnalysisJobs.alertId, alertId))
      .limit(1);
    return Boolean(row);
  }

  async claimById(jobId: string): Promise<MonitoringAnalysisJob | null> {
    const result = await this.db
      .update(monitoringAnalysisJobs)
      .set({ status: 'running', claimedAt: sql`CURRENT_TIMESTAMP` })
      .where(
        and(eq(monitoringAnalysisJobs.id, jobId), eq(monitoringAnalysisJobs.status, 'queued')),
      );
    const affected = (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
    if (affected === 0) return null;
    return this.findById(jobId);
  }

  async complete(input: {
    id: string;
    status: Extract<MonitoringAnalysisStatus, 'succeeded' | 'failed' | 'cancelled'>;
    resultMarkdown: string | null;
    error: string | null;
    costUsd: number | null;
    tokensIn: number | null;
    tokensOut: number | null;
  }): Promise<void> {
    await this.db
      .update(monitoringAnalysisJobs)
      .set({
        status: input.status,
        resultMarkdown: input.resultMarkdown,
        error: input.error,
        costUsd: input.costUsd === null ? null : String(input.costUsd),
        tokensIn: input.tokensIn,
        tokensOut: input.tokensOut,
        finishedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(monitoringAnalysisJobs.id, input.id));
  }

  async cancelStale(input: {
    olderThan: Date;
    reason: string;
    statuses: ReadonlyArray<Extract<MonitoringAnalysisStatus, 'queued' | 'running'>>;
  }): Promise<number> {
    const result = await this.db
      .update(monitoringAnalysisJobs)
      .set({ status: 'cancelled', error: input.reason, finishedAt: sql`CURRENT_TIMESTAMP` })
      .where(
        and(
          inArray(monitoringAnalysisJobs.status, [...input.statuses] as MonitoringAnalysisStatus[]),
          lt(monitoringAnalysisJobs.createdAt, input.olderThan),
        ),
      );
    return (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
  }

  async deleteTerminal(input: { olderThan: Date }): Promise<number> {
    const result = await this.db
      .delete(monitoringAnalysisJobs)
      .where(
        and(
          inArray(monitoringAnalysisJobs.status, ['succeeded', 'failed', 'cancelled'] as MonitoringAnalysisStatus[]),
          lt(monitoringAnalysisJobs.createdAt, input.olderThan),
        ),
      );
    return (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
  }

  private async findRowById(id: string): Promise<MonitoringAnalysisJobRow | undefined> {
    const [row] = await this.db
      .select()
      .from(monitoringAnalysisJobs)
      .where(eq(monitoringAnalysisJobs.id, id))
      .limit(1);
    return row;
  }
}

function rowToJob(row: MonitoringAnalysisJobRow): MonitoringAnalysisJob {
  return {
    id: row.id,
    createdBy: row.createdBy,
    projectId: row.projectId,
    serverId: row.serverId,
    dispatcherUserId: row.dispatcherUserId,
    status: row.status,
    analysisType: row.analysisType,
    alertId: row.alertId ?? null,
    context: row.context ?? null,
    note: row.note ?? null,
    resultMarkdown: row.resultMarkdown ?? null,
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
