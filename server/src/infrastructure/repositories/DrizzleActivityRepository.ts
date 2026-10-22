import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { activityEvents, liveSessions, projects, tasks, type ActivityEventRow } from '../db/schema.js';
import type { ActivityEvent, ActivityKind, ActivityPayload } from '../../domain/activity/ActivityEvent.js';
import type {
  ActivityRepository,
  RecordActivityInput,
} from '../../application/activity/ActivityRepository.js';
// Видимость события — через единое пространство (workspace_members, is_inbox→owner),
// НЕ project_members (#блокер3, отчёт fix-blockers-report.md) — переиспользуем
// ProjectMemberRepository (эталон DrizzleProjectMemberRepository).
import type { ProjectMemberRepository } from '../../application/project/ProjectMemberRepository.js';
import { parseJsonCol } from './jsonCol.js';

function toEvent(row: ActivityEventRow): ActivityEvent {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    actorUserId: row.actorUserId ?? null,
    kind: row.kind as ActivityKind,
    payload: parseJsonCol<ActivityPayload | null>(row.payload, null),
    createdAt: row.createdAt,
  };
}

export class DrizzleActivityRepository implements ActivityRepository {
  constructor(
    private readonly db: Database,
    private readonly projectMembers: ProjectMemberRepository,
  ) {}

  async record(input: RecordActivityInput): Promise<void> {
    await this.db.insert(activityEvents).values({
      id: input.id,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      actorUserId: input.actorUserId,
      kind: input.kind,
      payload: input.payload,
    });
  }

  // Видимость: событие видно, если userId — участник пространства ПРОЕКТА события (единое
  // пространство, workspace_members), с сохранением инварианта приватности Входящих
  // (is_inbox → только владелец). listProjectsForUserInWorkspace уже инкапсулирует этот
  // предикат (projectRowVisibility) — переиспользуем вместо project_members-join'а (#блокер3:
  // ws-участник без ленивой project_members-строки видел пустую ленту «Активность»/«Все»).
  async listForUserInWorkspace(
    userId: string,
    workspaceId: string,
    opts: { before?: Date; limit: number },
  ): Promise<ActivityEvent[]> {
    const myProjects = await this.projectMembers.listProjectsForUserInWorkspace(userId, workspaceId);
    const projectIds = myProjects.map((p) => p.id);
    if (projectIds.length === 0) return [];

    const conds = [
      eq(activityEvents.workspaceId, workspaceId),
      inArray(activityEvents.projectId, projectIds),
    ];
    if (opts.before) conds.push(lt(activityEvents.createdAt, opts.before));
    const rows = await this.db
      .select()
      .from(activityEvents)
      .where(and(...conds))
      .orderBy(desc(activityEvents.createdAt))
      .limit(opts.limit);
    return rows.map((r) => toEvent(r));
  }

  async listForProject(
    projectId: string,
    opts: { before?: Date; beforeId?: string; limit: number },
  ): Promise<ActivityEvent[]> {
    const conds = [eq(activityEvents.projectId, projectId)];
    if (opts.before) {
      conds.push(
        opts.beforeId
          ? or(
              lt(activityEvents.createdAt, opts.before),
              and(
                eq(activityEvents.createdAt, opts.before),
                lt(activityEvents.id, opts.beforeId),
              ),
            )!
          : lt(activityEvents.createdAt, opts.before),
      );
    }
    const rows = await this.db
      .select()
      .from(activityEvents)
      .where(and(...conds))
      .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id))
      .limit(opts.limit);
    return rows.map((r) => toEvent(r));
  }

  // Keep the action's real author in the audit log. Worker work belongs to the
  // task assignee, even when a different dispatcher account performed the move.
  // UNION and COUNT DISTINCT deduplicate retries, approval and human/worker overlap.
  private completedTaskCredits(userId: string, since: Date) {
    const finished = and(isNull(tasks.deletedAt), inArray(tasks.status, ['done', 'pending_approval']));
    return sql`
      SELECT ${tasks.id} AS task_id, ${activityEvents.workspaceId} AS workspace_id
      FROM ${activityEvents}
      INNER JOIN ${tasks} ON ${tasks.id} = JSON_UNQUOTE(JSON_EXTRACT(${activityEvents.payload}, '$.taskId'))
      WHERE ${activityEvents.actorUserId} = ${userId}
        AND ${activityEvents.kind} = 'task_status_changed'
        AND ${gte(activityEvents.createdAt, since)}
        AND JSON_UNQUOTE(JSON_EXTRACT(${activityEvents.payload}, '$.newStatus')) IN ('done', 'pending_approval')
        AND ${finished}
      UNION
      SELECT ${tasks.id} AS task_id, ${projects.workspaceId} AS workspace_id
      FROM ${liveSessions}
      INNER JOIN ${tasks} ON ${tasks.id} = ${liveSessions.taskId} AND ${tasks.projectId} = ${liveSessions.projectId}
      INNER JOIN ${projects} ON ${projects.id} = ${tasks.projectId}
      WHERE ${tasks.assigneeUserId} = ${userId}
        AND ${liveSessions.status} = 'completed'
        AND ${gte(liveSessions.endedAt, since)}
        AND ${finished}
    `;
  }

  async countTasksCompletedByActorSince(userId: string, since: Date, workspaceId: string): Promise<number> {
    const result = await this.db.execute(sql`
      SELECT COUNT(DISTINCT task_id) AS n FROM (${this.completedTaskCredits(userId, since)}) AS completed_tasks
      WHERE workspace_id = ${workspaceId}
    `);
    const rows = result[0] as unknown as Array<{ n: number | string }>;
    return Number(rows[0]?.n ?? 0);
  }

  async countCompletedByActorPerWorkspaceSince(userId: string, since: Date): Promise<Array<{ workspaceId: string; count: number }>> {
    const result = await this.db.execute(sql`
      SELECT workspace_id AS workspaceId, COUNT(DISTINCT task_id) AS n
      FROM (${this.completedTaskCredits(userId, since)}) AS completed_tasks
      GROUP BY workspace_id
    `);
    const rows = result[0] as unknown as Array<{ workspaceId: string; n: number | string }>;
    return rows.map(row => ({ workspaceId: row.workspaceId, count: Number(row.n) }));
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    const result = await this.db.delete(activityEvents).where(lt(activityEvents.createdAt, cutoff));
    // mysql2: первый элемент — ResultSetHeader с affectedRows.
    const header = (result as unknown as [{ affectedRows?: number }])[0];
    return header?.affectedRows ?? 0;
  }
}
