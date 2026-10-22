import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { TelegramWorkerResultOutbox, WorkerCompletion, WorkerResultDelivery } from '../../application/telegram/TelegramWorkerResultOutbox.js';

type DeliveryRow = RowDataPacket & {
  id: string; task_id: string; project_id: string; completion_key: string;
  source: WorkerResultDelivery['source']; tg_chat_id: number; tg_message_id: number | null; requested_at: Date;
};
const map = (r: DeliveryRow): WorkerResultDelivery => ({
  id: r.id, taskId: r.task_id, projectId: r.project_id, completionKey: r.completion_key,
  source: r.source, chatId: Number(r.tg_chat_id), messageId: r.tg_message_id === null ? null : Number(r.tg_message_id), requestedAt: r.requested_at,
});
// Approval itself is not another worker completion. Only the assigned dispatcher
// moving active work into review/completed provides a recovery signal.
const completionEvent = `a.kind='task_status_changed'
  AND a.actor_user_id=p.dispatcher_user_id
  AND JSON_UNQUOTE(JSON_EXTRACT(a.payload,'$.taskId'))=t.id
  AND JSON_UNQUOTE(JSON_EXTRACT(a.payload,'$.newStatus')) IN ('done','pending_approval')
  AND JSON_UNQUOTE(JSON_EXTRACT(a.payload,'$.oldStatus')) NOT IN ('done','pending_approval')`;

export class MysqlTelegramWorkerResultOutbox implements TelegramWorkerResultOutbox {
  constructor(private readonly pool: Pool) {}

  async findCompletion(taskId: string, projectId: string): Promise<WorkerCompletion | null> {
    const [events] = await this.pool.query<(RowDataPacket & { id: string; created_at: Date })[]>(
      `SELECT a.id,a.created_at FROM tasks t JOIN projects p ON p.id=t.project_id
       JOIN activity_events a ON a.project_id=p.id WHERE t.id=? AND p.id=? AND ${completionEvent}
       ORDER BY a.created_at DESC,a.id DESC LIMIT 1`, [taskId, projectId]);
    const event = events[0];
    if (!event) return null;
    const [sessions] = await this.pool.query<(RowDataPacket & { id: string; started_at: Date; status: string })[]>(
      `SELECT id,started_at,status FROM live_sessions WHERE task_id=? AND project_id=? AND agent_name='ralph-worker'
       AND started_at<=? + INTERVAL 1 SECOND AND (ended_at IS NULL OR ended_at>=? - INTERVAL 1 SECOND)
       ORDER BY started_at DESC,id DESC LIMIT 1`, [taskId, projectId, event.created_at, event.created_at]);
    const session = sessions[0];
    if (session && (session.status === 'failed' || session.status === 'canceled')) return null;
    return session ? { key: `session:${session.id}`, startedAt: session.started_at }
      : { key: `event:${event.id}`, startedAt: event.created_at };
  }

  async listRecoverable(now: Date, limit: number): Promise<string[]> {
    const [rows] = await this.pool.query<(RowDataPacket & { id: string })[]>(
      `SELECT t.id FROM tasks t JOIN projects p ON p.id=t.project_id
       JOIN activity_events a ON a.project_id=p.id WHERE t.deleted_at IS NULL
       AND t.status IN ('done','pending_approval') AND a.created_at>=? AND ${completionEvent}
       GROUP BY t.id ORDER BY MAX(a.created_at) DESC,t.id LIMIT ?`, [new Date(now.getTime() - 86_400_000), limit]);
    return rows.map((r) => r.id);
  }

  async enqueue(d: WorkerResultDelivery): Promise<void> {
    await this.pool.query(`INSERT IGNORE INTO telegram_worker_result_deliveries
      (id,task_id,project_id,completion_key,source,tg_chat_id,tg_message_id,requested_at) VALUES (?,?,?,?,?,?,?,?)`,
    [d.id,d.taskId,d.projectId,d.completionKey,d.source,d.chatId,d.messageId,d.requestedAt]);
  }
  async listDue(now: Date, limit: number): Promise<WorkerResultDelivery[]> {
    const [rows] = await this.pool.query<DeliveryRow[]>(`SELECT * FROM telegram_worker_result_deliveries
      WHERE sent_at IS NULL AND (retry_at IS NULL OR retry_at<=?) AND (claim_until IS NULL OR claim_until<=?)
      ORDER BY requested_at LIMIT ?`, [now,now,limit]);
    return rows.map(map);
  }
  async claim(id: string, token: string, now: Date, until: Date): Promise<boolean> {
    const [r] = await this.pool.query<ResultSetHeader>(`UPDATE telegram_worker_result_deliveries SET claim_token=?,claim_until=?
      WHERE id=? AND sent_at IS NULL AND (retry_at IS NULL OR retry_at<=?) AND (claim_until IS NULL OR claim_until<=?)`, [token,until,id,now,now]);
    return r.affectedRows === 1;
  }
  async finish(id: string, token: string, now: Date): Promise<void> {
    await this.pool.query(`UPDATE telegram_worker_result_deliveries SET sent_at=?,claim_token=NULL,claim_until=NULL,retry_at=NULL
      WHERE id=? AND claim_token=?`, [now,id,token]);
  }
  async retry(id: string, token: string, at: Date): Promise<void> {
    await this.pool.query(`UPDATE telegram_worker_result_deliveries SET retry_at=?,claim_token=NULL,claim_until=NULL
      WHERE id=? AND claim_token=?`, [at,id,token]);
  }
}
