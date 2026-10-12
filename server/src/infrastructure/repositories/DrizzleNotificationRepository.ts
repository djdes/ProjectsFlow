import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { notifications, projects, tasks, type NotificationRow } from '../db/schema.js';
import type {
  Notification,
  NotificationPayload,
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
    if (opts.workspaceId) conds.push(eq(notifications.workspaceId, opts.workspaceId));
    if (opts.actionableOnly) conds.push(inArray(notifications.type, ['workspace_invite', 'project_invite', 'join_request']));
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

  async countUnread(userId: string, workspaceId?: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt),
        workspaceId ? eq(notifications.workspaceId, workspaceId) : undefined));
    return Number(rows[0]?.count ?? 0);
  }

  async countActionableUnread(userId: string, workspaceId?: string): Promise<number> {
    // Actionable-типы (кнопка «Принять») — те же, что формируют вкладку «Действие».
    // Зеркало GetActivityFeed.ACTIONABLE_TYPES — менять СИНХРОННО. Назначение
    // ответственного информационное; сводки/упоминания сюда НЕ входят.
    const rows = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          workspaceId ? eq(notifications.workspaceId, workspaceId) : undefined,
          isNull(notifications.readAt),
          inArray(notifications.type, ['workspace_invite', 'project_invite', 'join_request']),
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
          workspaceId ? eq(notifications.workspaceId, workspaceId) : undefined),
      );
    const affected = (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
    return affected > 0;
  }

  async markAllRead(userId: string, readAt: Date, workspaceId?: string): Promise<number> {
    const result = await this.db
      .update(notifications)
      .set({ readAt })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt),
        workspaceId ? eq(notifications.workspaceId, workspaceId) : undefined));
    return (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
  }
}
