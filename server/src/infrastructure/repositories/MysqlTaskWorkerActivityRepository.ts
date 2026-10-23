import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { TaskWorkerActivityRepository } from '../../application/live/TaskWorkerActivityRepository.js';
import { taskWorkerActivities, type TaskWorkerActivity } from '../../domain/live/TaskWorkerActivity.js';

export class MysqlTaskWorkerActivityRepository implements TaskWorkerActivityRepository {
  constructor(private readonly pool: Pool) {}
  async listByProject(projectId: string): Promise<TaskWorkerActivity[]> {
    const [sessions, comments] = await Promise.all([
      this.pool.query<(RowDataPacket & { task_id: string; id: string; status: string; started_at: Date; ended_at: Date | null })[]>(`
        SELECT s.task_id,s.id,s.status,s.started_at,s.ended_at FROM (
          SELECT l.*,ROW_NUMBER() OVER (PARTITION BY l.task_id ORDER BY l.started_at DESC,l.base_seq DESC,l.attempt DESC,l.id DESC) AS rn
          FROM live_sessions l WHERE l.project_id=?
        ) s JOIN tasks t ON t.id=s.task_id AND t.project_id=?
        WHERE s.rn=1 AND t.deleted_at IS NULL AND t.status<>'done'`, [projectId, projectId]),
      this.pool.query<(RowDataPacket & { task_id: string; id: string; actor_kind: string; body: string; created_at: Date })[]>(`
        SELECT c.task_id,c.id,c.actor_kind,c.body,c.created_at FROM task_comments c
        JOIN tasks t ON t.id=c.task_id AND t.project_id=?
        WHERE t.deleted_at IS NULL AND t.status<>'done' AND (
          (c.actor_kind='agent' AND c.body LIKE '%ralph-question%') OR
          (c.actor_kind='user' AND c.body LIKE '%ralph-answer%'))`, [projectId]),
    ]);
    return taskWorkerActivities(
      sessions[0].map(row => ({ taskId: row.task_id, id: row.id, status: row.status, startedAt: row.started_at, endedAt: row.ended_at })),
      comments[0].map(row => ({ taskId: row.task_id, id: row.id, actorKind: row.actor_kind, body: row.body, createdAt: row.created_at })),
    );
  }
}
