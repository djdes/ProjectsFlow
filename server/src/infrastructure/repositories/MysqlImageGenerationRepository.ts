import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { ImageGenerationRepository } from '../../application/image-generation/ImageGenerationRepository.js';
import { ImageGenerationError, type ImageGeneration } from '../../domain/image-generation/ImageGeneration.js';
const fields = `id, user_id AS userId, conversation_id AS conversationId, dispatcher_user_id AS dispatcherUserId, prompt, status, claim_token AS claimToken, storage_key AS storageKey, error_message AS errorMessage, created_at AS createdAt, started_at AS startedAt, finished_at AS finishedAt`;
export class MysqlImageGenerationRepository implements ImageGenerationRepository {
  constructor(private readonly pool: Pool) {}
  async create(job: Pick<ImageGeneration, 'id'|'userId'|'dispatcherUserId'|'prompt'|'conversationId'>): Promise<ImageGeneration> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query('SELECT id FROM users WHERE id=? FOR UPDATE', [job.userId]);
      const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS total, SUM(status IN ('queued','running')) AS active FROM image_generation_jobs WHERE user_id=? AND created_at >= UTC_TIMESTAMP() - INTERVAL 1 DAY`, [job.userId]);
      if (Number(rows[0]?.active) >= 2 || Number(rows[0]?.total) >= 10) throw new ImageGenerationError(429, 'Лимит: две генерации одновременно и десять за сутки');
      await connection.query('INSERT INTO image_generation_jobs (id,user_id,dispatcher_user_id,prompt,conversation_id) VALUES (?,?,?,?,?)', [job.id,job.userId,job.dispatcherUserId,job.prompt,job.conversationId ?? null]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    return (await this.get(job.id))!;
  }
  async list(userId: string, conversationId?: string): Promise<ImageGeneration[]> {
    await this.expire();
    const [rows] = await this.pool.query<RowDataPacket[]>(`SELECT ${fields} FROM image_generation_jobs WHERE user_id=?${conversationId ? ' AND conversation_id=?' : ''} ORDER BY created_at DESC LIMIT 40`, conversationId ? [userId, conversationId] : [userId]);
    return rows as ImageGeneration[];
  }
  async get(id: string): Promise<ImageGeneration | null> {
    const [rows] = await this.pool.query<RowDataPacket[]>(`SELECT ${fields} FROM image_generation_jobs WHERE id=?`, [id]);
    return rows[0] as ImageGeneration | undefined ?? null;
  }
  async claim(dispatcherUserId: string, token: string): Promise<ImageGeneration | null> {
    await this.expire();
    const connection = await this.pool.getConnection();
    let claimedId: string | null = null;
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<RowDataPacket[]>("SELECT id FROM image_generation_jobs WHERE dispatcher_user_id=? AND status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE", [dispatcherUserId]);
      const id = rows[0]?.id as string | undefined;
      if (!id) { await connection.commit(); return null; }
      await connection.query("UPDATE image_generation_jobs SET status='running',claim_token=?,started_at=UTC_TIMESTAMP(3) WHERE id=?", [token,id]);
      await connection.commit();
      claimedId = id;
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    return claimedId ? this.get(claimedId) : null;
  }
  async complete(id: string, token: string, key: string | null, error: string | null): Promise<boolean> {
    const [result] = await this.pool.query<ResultSetHeader>("UPDATE image_generation_jobs SET status=?, storage_key=?, error_message=?,finished_at=UTC_TIMESTAMP(3) WHERE id=? AND claim_token=? AND status='running'", [key?'succeeded':'failed',key,error,id,token]);
    return result.affectedRows === 1;
  }
  private async expire(): Promise<void> {
    await this.pool.query("UPDATE image_generation_jobs SET status='failed',error_message='Генерация прервана. Попробуйте ещё раз.',finished_at=UTC_TIMESTAMP(3) WHERE (status='running' AND started_at<UTC_TIMESTAMP()-INTERVAL 20 MINUTE) OR (status='queued' AND created_at<UTC_TIMESTAMP()-INTERVAL 1 DAY)");
  }
}
