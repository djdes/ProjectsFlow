import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { notifications, type NotificationRow } from '../db/schema.js';
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
    userId: row.userId,
    payload,
    readAt: row.readAt ?? null,
    createdAt: row.createdAt,
  };
}

export class DrizzleNotificationRepository implements NotificationRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateNotificationInput): Promise<Notification> {
    await this.db.insert(notifications).values({
      id: input.id,
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
    opts: { limit: number; unreadOnly: boolean },
  ): Promise<Notification[]> {
    const whereExpr = opts.unreadOnly
      ? and(eq(notifications.userId, userId), isNull(notifications.readAt))
      : eq(notifications.userId, userId);
    const rows = await this.db
      .select()
      .from(notifications)
      .where(whereExpr)
      .orderBy(desc(notifications.createdAt))
      .limit(opts.limit);
    return rows.map(toNotification);
  }

  async countUnread(userId: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return Number(rows[0]?.count ?? 0);
  }

  async markRead(id: string, userId: string, readAt: Date): Promise<boolean> {
    const result = await this.db
      .update(notifications)
      .set({ readAt })
      .where(
        and(eq(notifications.id, id), eq(notifications.userId, userId), isNull(notifications.readAt)),
      );
    const affected = (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
    return affected > 0;
  }

  async markAllRead(userId: string, readAt: Date): Promise<number> {
    const result = await this.db
      .update(notifications)
      .set({ readAt })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
  }
}
