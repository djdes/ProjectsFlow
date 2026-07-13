import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { activityEvents, type ActivityEventRow } from '../db/schema.js';
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
    opts: { before?: Date; limit: number },
  ): Promise<ActivityEvent[]> {
    const conds = [eq(activityEvents.projectId, projectId)];
    if (opts.before) conds.push(lt(activityEvents.createdAt, opts.before));
    const rows = await this.db
      .select()
      .from(activityEvents)
      .where(and(...conds))
      .orderBy(desc(activityEvents.createdAt))
      .limit(opts.limit);
    return rows.map((r) => toEvent(r));
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    const result = await this.db.delete(activityEvents).where(lt(activityEvents.createdAt, cutoff));
    // mysql2: первый элемент — ResultSetHeader с affectedRows.
    const header = (result as unknown as [{ affectedRows?: number }])[0];
    return header?.affectedRows ?? 0;
  }
}
