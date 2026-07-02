import { and, desc, eq, lt } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { activityEvents, projectMembers, type ActivityEventRow } from '../db/schema.js';
import type { ActivityEvent, ActivityKind, ActivityPayload } from '../../domain/activity/ActivityEvent.js';
import type {
  ActivityRepository,
  RecordActivityInput,
} from '../../application/activity/ActivityRepository.js';
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
  constructor(private readonly db: Database) {}

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

  async listForUserInWorkspace(
    userId: string,
    workspaceId: string,
    opts: { before?: Date; limit: number },
  ): Promise<ActivityEvent[]> {
    const conds = [
      eq(activityEvents.workspaceId, workspaceId),
      eq(projectMembers.userId, userId),
    ];
    if (opts.before) conds.push(lt(activityEvents.createdAt, opts.before));
    const rows = await this.db
      .select({ ae: activityEvents })
      .from(activityEvents)
      .innerJoin(projectMembers, eq(projectMembers.projectId, activityEvents.projectId))
      .where(and(...conds))
      .orderBy(desc(activityEvents.createdAt))
      .limit(opts.limit);
    return rows.map((r) => toEvent(r.ae));
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
