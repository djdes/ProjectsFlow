import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { TelegramTaskOrigin, TelegramTaskOriginRepository } from '../../application/telegram/TelegramTaskOriginRepository.js';
type Row = RowDataPacket & {
  task_id: string;
  project_id: string;
  tg_chat_id: number;
  tg_message_id: number | null;
  requested_at: Date | null;
  sent_at: Date | null;
};
const map = (row: Row): TelegramTaskOrigin => ({
  taskId: row.task_id,
  projectId: row.project_id,
  chatId: Number(row.tg_chat_id),
  messageId: row.tg_message_id === null ? null : Number(row.tg_message_id),
  requestedAt: row.requested_at,
  reportedAt: row.sent_at,
});

export class MysqlTelegramTaskOriginRepository implements TelegramTaskOriginRepository {
  constructor(private readonly pool: Pool) {}

  async attach(origin: Omit<TelegramTaskOrigin, 'requestedAt'>): Promise<void> {
    await this.pool.query(
      `INSERT IGNORE INTO telegram_task_origins (task_id, project_id, tg_chat_id, tg_message_id)
       VALUES (?, ?, ?, ?)`,
      [origin.taskId, origin.projectId, origin.chatId, origin.messageId],
    );
  }

  async getByTask(taskId: string): Promise<TelegramTaskOrigin | null> {
    const [rows] = await this.pool.query<Row[]>('SELECT * FROM telegram_task_origins WHERE task_id = ?', [taskId]);
    return rows[0] ? map(rows[0]) : null;
  }

  async requestResult(taskId: string, now: Date): Promise<void> {
    await this.pool.query(
      `UPDATE telegram_task_origins SET requested_at = COALESCE(requested_at, ?)
       WHERE task_id = ? AND sent_at IS NULL`,
      [now, taskId],
    );
  }

  async recoverCompleted(now: Date): Promise<void> {
    // Destinations are captured during intake. Digest/reply mappings are not origins:
    // mentioning a task in another group must never subscribe that group to its results.
    // Explicit completion requests also work with LIVE disabled. Reconciliation only
    // recovers verified completed runs, never a task finished solely by a human.
    await this.pool.query(`UPDATE telegram_task_origins o JOIN tasks t ON t.id=o.task_id AND t.project_id=o.project_id
      SET o.requested_at=? WHERE o.requested_at IS NULL AND o.sent_at IS NULL AND t.deleted_at IS NULL
      AND t.status IN ('done','pending_approval') AND EXISTS(SELECT 1 FROM live_sessions s WHERE s.task_id=t.id AND s.status='completed' AND s.ended_at>=UTC_TIMESTAMP()-INTERVAL 1 DAY)`,[now]);
  }
  async listDue(now: Date, limit: number): Promise<TelegramTaskOrigin[]> {
    const [rows] = await this.pool.query<Row[]>(
      `SELECT * FROM telegram_task_origins WHERE requested_at IS NOT NULL AND sent_at IS NULL
       AND (retry_at IS NULL OR retry_at <= ?) AND (claim_until IS NULL OR claim_until <= ?)
       ORDER BY requested_at LIMIT ?`,
      [now, now, limit],
    );
    return rows.map(map);
  }

  async claim(taskId: string, token: string, now: Date, until: Date): Promise<boolean> {
    const [result] = await this.pool.query<ResultSetHeader>(
      `UPDATE telegram_task_origins SET claim_token = ?, claim_until = ?
       WHERE task_id = ? AND requested_at IS NOT NULL AND sent_at IS NULL
       AND (retry_at IS NULL OR retry_at <= ?) AND (claim_until IS NULL OR claim_until <= ?)`,
      [token, until, taskId, now, now],
    );
    return result.affectedRows === 1;
  }

  async finish(taskId: string, token: string, now: Date): Promise<void> {
    await this.pool.query(
      `UPDATE telegram_task_origins SET sent_at = ?, claim_token = NULL, claim_until = NULL, retry_at = NULL
       WHERE task_id = ? AND claim_token = ?`,
      [now, taskId, token],
    );
  }

  async retry(taskId: string, token: string, at: Date): Promise<void> {
    await this.pool.query(
      `UPDATE telegram_task_origins SET retry_at = ?, claim_token = NULL, claim_until = NULL
       WHERE task_id = ? AND claim_token = ?`,
      [at, taskId, token],
    );
  }
}
