import { and, desc, eq, gt, inArray, isNull, lt, notInArray, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { notifications, projects, tasks, type NotificationRow } from '../db/schema.js';
import {
  ACTIONABLE_NOTIFICATION_TYPES,
  PERSONAL_NOTIFICATION_TYPES,
  type Notification,
  type NotificationPayload,
} from '../../domain/notifications/Notification.js';
import type {
  CreateNotificationInput,
  NotificationRepository,
} from '../../application/notifications/NotificationRepository.js';

function toNotification(row: NotificationRow): Notification {
  // MariaDB хранит JSON как LONGTEXT → mysql2 возвращает строку, а не объект.
  // drizzle-orm не парсит (нет mapFromDriverValue для json-колонки). Парсим вручную.
  const payload: NotificationPayload =
    typeof row.payload === 'string'
      ? (JSON.parse(row.payload) as NotificationPayload)
      : (row.payload as NotificationPayload);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    payload,
    readAt: row.readAt ?? null,
    createdAt: row.createdAt,
  };
}

// Уведомления активного пространства плюс личные — зеркало isVisibleInWorkspace (домен).
function visibleIn(workspaceId: string | undefined): SQL | undefined {
  if (!workspaceId) return undefined;
  return or(
    eq(notifications.workspaceId, workspaceId),
    isNull(notifications.workspaceId),
    inArray(notifications.type, [...PERSONAL_NOTIFICATION_TYPES]),
  );
}

const ACTIONABLE = [...ACTIONABLE_NOTIFICATION_TYPES];

export class DrizzleNotificationRepository implements NotificationRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateNotificationInput): Promise<Notification> {
    const payload = input.payload;
    let workspaceId: string | null = 'workspaceId' in payload ? payload.workspaceId : null;
    if ('projectId' in payload) {
      const rows = await this.db.select({ id: projects.workspaceId }).from(projects)
        .where(eq(projects.id, payload.projectId)).limit(1);
      workspaceId = rows[0]?.id ?? null;
    } else if ('taskId' in payload) {
      const rows = await this.db.select({ id: projects.workspaceId }).from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .where(eq(tasks.id, payload.taskId)).limit(1);
      workspaceId = rows[0]?.id ?? null;
    }
    await this.db.insert(notifications).values({
      id: input.id,
      workspaceId,
      userId: input.userId,
      type: input.payload.type,
      payload: input.payload,
    });
    const rows = await this.db
      .select()
      .from(notifications)
      .where(eq(notifications.id, input.id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error('Failed to read back notification after insert');
    return toNotification(row);
  }

  async listByUser(
    userId: string,
    opts: { limit: number; unreadOnly: boolean; before?: Date; workspaceId?: string; actionableOnly?: boolean },
  ): Promise<Notification[]> {
    const conds = [eq(notifications.userId, userId)];
    const scope = visibleIn(opts.workspaceId);
    if (scope) conds.push(scope);
    if (opts.actionableOnly) conds.push(inArray(notifications.type, ACTIONABLE));
    if (opts.unreadOnly) conds.push(isNull(notifications.readAt));
    if (opts.before) conds.push(lt(notifications.createdAt, opts.before));
    const rows = await this.db
      .select()
      .from(notifications)
      .where(and(...conds))
      .orderBy(desc(notifications.createdAt))
      .limit(opts.limit);
    return rows.map(toNotification);
  }

  async countUnread(userId: string, workspaceId?: string, opts?: { since?: Date }): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), visibleIn(workspaceId),
        opts?.since ? or(gt(notifications.createdAt, opts.since), inArray(notifications.type, ACTIONABLE)) : undefined));
    return Number(rows[0]?.count ?? 0);
  }

  async countActionableUnread(userId: string, workspaceId?: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          visibleIn(workspaceId),
          isNull(notifications.readAt),
          inArray(notifications.type, ACTIONABLE),
        ),
      );
    return Number(rows[0]?.count ?? 0);
  }

  async markRead(id: string, userId: string, readAt: Date, workspaceId?: string): Promise<boolean> {
    const result = await this.db
      .update(notifications)
      .set({ readAt })
      .where(
        and(eq(notifications.id, id), eq(notifications.userId, userId), isNull(notifications.readAt),
          visibleIn(workspaceId)),
      );
    const affected = (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
    return affected > 0;
  }

  async markAllRead(userId: string, readAt: Date, workspaceId?: string): Promise<number> {
    const result = await this.db
      .update(notifications)
      .set({ readAt })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), visibleIn(workspaceId),
        notInArray(notifications.type, ACTIONABLE)));
    return (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
  }
}
