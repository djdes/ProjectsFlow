import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import type { AgentJob, AgentJobStatus } from '../../domain/agent/AgentJob.js';
import type {
  AgentJobRepository,
  CompleteAgentJobInput,
  NewAgentJobInput,
} from '../../application/agent/AgentJobRepository.js';
import { ACTIVE_AGENT_JOB_STATUSES } from '../../domain/agent/AgentJob.js';
import { idGenerator } from '../id/idGenerator.js';
import { agentJobs, type AgentJobRow } from '../db/schema.js';

export class DrizzleAgentJobRepository implements AgentJobRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewAgentJobInput): Promise<AgentJob> {
    const id = idGenerator();
    await this.db.insert(agentJobs).values({
      id,
      projectId: input.projectId,
      taskId: input.taskId,
      createdBy: input.createdBy,
      status: 'queued',
    });
    const row = await this.requireRow(id);
    return rowToJob(row);
  }

  async findById(id: string): Promise<AgentJob | null> {
    const [row] = await this.db.select().from(agentJobs).where(eq(agentJobs.id, id)).limit(1);
    return row ? rowToJob(row) : null;
  }

  async findActiveByTaskId(taskId: string): Promise<AgentJob | null> {
    const rows = await this.db
      .select()
      .from(agentJobs)
      .where(
        and(
          eq(agentJobs.taskId, taskId),
          inArray(agentJobs.status, [...ACTIVE_AGENT_JOB_STATUSES] as AgentJobStatus[]),
        ),
      )
      .limit(1);
    return rows[0] ? rowToJob(rows[0]) : null;
  }

  async findActiveByTaskIds(taskIds: readonly string[]): Promise<Map<string, AgentJob>> {
    if (taskIds.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(agentJobs)
      .where(
        and(
          inArray(agentJobs.taskId, [...taskIds]),
          inArray(agentJobs.status, [...ACTIVE_AGENT_JOB_STATUSES] as AgentJobStatus[]),
        ),
      );
    const result = new Map<string, AgentJob>();
    for (const row of rows) result.set(row.taskId, rowToJob(row));
    return result;
  }

  async listForProject(projectId: string, limit: number): Promise<AgentJob[]> {
    const rows = await this.db
      .select()
      .from(agentJobs)
      .where(eq(agentJobs.projectId, projectId))
      .orderBy(desc(agentJobs.createdAt))
      .limit(limit);
    return rows.map(rowToJob);
  }

  // Runner methods used in Plan B. In Plan A — stubs with correct signature.

  async claimNext(): Promise<AgentJob | null> {
    // TODO Plan B: SELECT ... FOR UPDATE SKIP LOCKED + check global cap + per-project mutex
    return null;
  }

  async markStarted(id: string): Promise<void> {
    await this.db
      .update(agentJobs)
      .set({ startedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(agentJobs.id, id));
  }

  async complete(id: string, result: CompleteAgentJobInput): Promise<void> {
    await this.db
      .update(agentJobs)
      .set({
        status: result.status,
        finishedAt: sql`CURRENT_TIMESTAMP`,
        error: result.error ?? null,
        prUrl: result.prUrl ?? null,
        branchName: result.branchName ?? null,
      })
      .where(eq(agentJobs.id, id));
  }

  async cancel(id: string, reason: string): Promise<void> {
    await this.db
      .update(agentJobs)
      .set({
        status: 'cancelled',
        finishedAt: sql`CURRENT_TIMESTAMP`,
        error: reason,
      })
      .where(eq(agentJobs.id, id));
  }

  private async requireRow(id: string): Promise<AgentJobRow> {
    const [row] = await this.db.select().from(agentJobs).where(eq(agentJobs.id, id)).limit(1);
    if (!row) throw new Error(`agent_jobs row ${id} disappeared after insert`);
    return row;
  }
}

function rowToJob(row: AgentJobRow): AgentJob {
  return {
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    status: row.status,
    attempt: row.attempt,
    claimedAt: row.claimedAt ?? null,
    startedAt: row.startedAt ?? null,
    finishedAt: row.finishedAt ?? null,
    error: row.error ?? null,
    prUrl: row.prUrl ?? null,
    branchName: row.branchName ?? null,
    runnerPid: row.runnerPid ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
