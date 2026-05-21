import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import type { AgentJob, AgentJobStatus } from '../../domain/agent/AgentJob.js';
import type {
  AgentJobRepository,
  CompleteAgentJobInput,
  NewAgentJobInput,
  PendingAgentJob,
} from '../../application/agent/AgentJobRepository.js';
import { ACTIVE_AGENT_JOB_STATUSES } from '../../domain/agent/AgentJob.js';
import { idGenerator } from '../id/idGenerator.js';
import { agentJobs, projectMembers, projects, tasks, type AgentJobRow } from '../db/schema.js';

export class DrizzleAgentJobRepository implements AgentJobRepository {
  constructor(private readonly db: Database) {}

  async createForDelegation(input: NewAgentJobInput): Promise<AgentJob> {
    const id = idGenerator();
    return this.db.transaction(async (tx) => {
      await tx
        .update(tasks)
        .set({ delegatedToAgent: true })
        .where(eq(tasks.id, input.taskId));
      await tx.insert(agentJobs).values({
        id,
        projectId: input.projectId,
        taskId: input.taskId,
        createdBy: input.createdBy,
        status: 'queued',
      });
      const [row] = await tx.select().from(agentJobs).where(eq(agentJobs.id, id)).limit(1);
      if (!row) throw new Error(`agent_jobs row ${id} disappeared after insert`);
      return rowToJob(row);
    });
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

  // Runner methods (Plan B).

  async listPendingForUser(userId: string, limit: number): Promise<PendingAgentJob[]> {
    // JOIN: agent_jobs → projects → project_members WHERE pm.user_id=? AND aj.status='queued'
    const rows = await this.db
      .select({
        jobId: agentJobs.id,
        projectId: agentJobs.projectId,
        taskId: agentJobs.taskId,
        createdAt: agentJobs.createdAt,
        projectName: projects.name,
        gitRepoUrl: projects.gitRepoUrl,
        taskDescription: tasks.description,
      })
      .from(agentJobs)
      .innerJoin(projects, eq(agentJobs.projectId, projects.id))
      .innerJoin(tasks, eq(agentJobs.taskId, tasks.id))
      .innerJoin(projectMembers, eq(projectMembers.projectId, agentJobs.projectId))
      .where(and(
        eq(agentJobs.status, 'queued'),
        eq(projectMembers.userId, userId),
      ))
      .orderBy(asc(agentJobs.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.jobId,
      projectId: r.projectId,
      projectName: r.projectName,
      gitRepoUrl: r.gitRepoUrl ?? null,
      taskId: r.taskId,
      taskDescription: r.taskDescription ?? null,
      createdAt: r.createdAt,
    }));
  }

  async claimById(jobId: string): Promise<AgentJob | null> {
    const result = await this.db
      .update(agentJobs)
      .set({
        status: 'running',
        claimedAt: sql`CURRENT_TIMESTAMP`,
        startedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(agentJobs.id, jobId), eq(agentJobs.status, 'queued')));
    const affected = (result as unknown as { rowsAffected?: number; affectedRows?: number })
      .rowsAffected ?? (result as unknown as { affectedRows?: number }).affectedRows ?? 0;
    if (affected === 0) return null;
    return this.findById(jobId);
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
