import { asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { commentNotifications, users } from '../db/schema.js';
import type {
  CommentNotificationLogRepository,
  CommentNotificationRecord,
  CommentNotificationWithUser,
  CommentNotificationChannel,
  CommentNotificationStatus,
} from '../../application/notifications/CommentNotificationLogRepository.js';

export class DrizzleCommentNotificationLogRepository
  implements CommentNotificationLogRepository
{
  constructor(private readonly db: Database) {}

  async recordMany(rows: readonly CommentNotificationRecord[]): Promise<void> {
    if (rows.length === 0) return;
    // UPSERT: повторный dispatch того же коммента перезаписывает исход (idempotent по
    // UNIQUE uq_comment_notif). VALUES(col) — MariaDB-совместимый синтаксис (см. CLAUDE.md §5).
    await this.db
      .insert(commentNotifications)
      .values(
        rows.map((r) => ({
          id: r.id,
          commentId: r.commentId,
          recipientUserId: r.recipientUserId,
          channel: r.channel,
          status: r.status,
          reason: r.reason,
        })),
      )
      .onDuplicateKeyUpdate({
        set: {
          status: sql`values(${commentNotifications.status})`,
          reason: sql`values(${commentNotifications.reason})`,
        },
      });
  }

  async listByComment(commentId: string): Promise<CommentNotificationWithUser[]> {
    const rows = await this.db
      .select({
        recipientUserId: commentNotifications.recipientUserId,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        channel: commentNotifications.channel,
        status: commentNotifications.status,
        reason: commentNotifications.reason,
        createdAt: commentNotifications.createdAt,
      })
      .from(commentNotifications)
      .leftJoin(users, eq(users.id, commentNotifications.recipientUserId))
      .where(eq(commentNotifications.commentId, commentId))
      .orderBy(asc(commentNotifications.recipientUserId), asc(commentNotifications.channel));

    return rows.map((r) => ({
      recipientUserId: r.recipientUserId,
      displayName: r.displayName ?? 'Участник',
      avatarUrl: r.avatarUrl ?? null,
      channel: r.channel as CommentNotificationChannel,
      status: r.status as CommentNotificationStatus,
      reason: r.reason ?? null,
      createdAt: r.createdAt,
    }));
  }
}
