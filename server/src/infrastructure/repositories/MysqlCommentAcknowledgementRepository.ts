import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { CommentAcknowledgementRepository } from '../../application/task/CommentAcknowledgementRepository.js';
import type { CommentAcknowledgement } from '../../domain/task/CommentAcknowledgement.js';

export class MysqlCommentAcknowledgementRepository implements CommentAcknowledgementRepository {
  constructor(private readonly pool: Pool) {}

  async set(commentId: string, userId: string, accepted: boolean): Promise<void> {
    if (!accepted) {
      await this.pool.query('DELETE FROM task_comment_acknowledgements WHERE comment_id = ? AND user_id = ?', [commentId, userId]);
      return;
    }
    // Capture the version in the same statement. Retrying acceptance is idempotent;
    // changing the comment invalidates previous acknowledgements.
    await this.pool.query(`INSERT INTO task_comment_acknowledgements (comment_id, user_id, comment_body_hash)
      SELECT id, ?, UNHEX(SHA2(body, 256)) FROM task_comments WHERE id = ?
      ON DUPLICATE KEY UPDATE
        created_at = IF(task_comment_acknowledgements.comment_body_hash = VALUES(comment_body_hash), task_comment_acknowledgements.created_at, CURRENT_TIMESTAMP(3)),
        comment_body_hash = VALUES(comment_body_hash)`, [userId, commentId]);
  }

  async listByComments(commentIds: readonly string[]): Promise<CommentAcknowledgement[]> {
    if (!commentIds.length) return [];
    const [rows] = await this.pool.query<(RowDataPacket & {
      comment_id: string; user_id: string; display_name: string; created_at: Date;
    })[]>(`SELECT a.comment_id, a.user_id,
        COALESCE(NULLIF(TRIM(u.display_name), ''), u.email, 'Без имени') AS display_name, a.created_at
      FROM task_comment_acknowledgements a
      JOIN task_comments c ON c.id = a.comment_id AND UNHEX(SHA2(c.body, 256)) = a.comment_body_hash
      JOIN users u ON u.id = a.user_id
      WHERE a.comment_id IN (?) ORDER BY a.created_at, a.user_id`, [[...commentIds]]);
    return rows.map(row => ({ commentId: row.comment_id, userId: row.user_id, displayName: row.display_name, acknowledgedAt: row.created_at }));
  }
}
