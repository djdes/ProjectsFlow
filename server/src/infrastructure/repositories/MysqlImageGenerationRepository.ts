import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { ImageGenerationFailure, ImageGenerationFailureQuery, ImageGenerationRepository } from '../../application/image-generation/ImageGenerationRepository.js';
import { ImageGenerationError, type ImageGeneration } from '../../domain/image-generation/ImageGeneration.js';
const fields = `id, user_id AS userId, conversation_id AS conversationId, dispatcher_user_id AS dispatcherUserId, prompt, status, claim_token AS claimToken, storage_key AS storageKey, error_message AS errorMessage, created_at AS createdAt, started_at AS startedAt, finished_at AS finishedAt`;
/** Лимиты генераций на аккаунт: одновременно и за скользящие сутки. perDay = 0 — без суточного лимита. */
export interface ImageGenerationLimits { readonly maxActive: number; readonly perDay: number }
export const DEFAULT_IMAGE_GENERATION_LIMITS: ImageGenerationLimits = { maxActive: 2, perDay: 10 };
/** «Остаток» при отключённом суточном лимите — клиенты проверяют remaining > 0. */
const UNLIMITED_REMAINING = 1000;

export class MysqlImageGenerationRepository implements ImageGenerationRepository {
  constructor(private readonly pool: Pool, private readonly limits: ImageGenerationLimits = DEFAULT_IMAGE_GENERATION_LIMITS) {}
  async quota(userId: string) {
    await this.expire();
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT status, GREATEST(1, CEIL(TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(3), created_at + INTERVAL 1 DAY) / 1000000)) AS releaseAfterSeconds
       FROM image_generation_jobs WHERE user_id=? AND created_at >= UTC_TIMESTAMP(3) - INTERVAL 1 DAY ORDER BY created_at`, [userId]);
    return {
      active: rows.filter(row => row.status === 'queued' || row.status === 'running').length,
      remaining: this.limits.perDay > 0 ? Math.max(0, this.limits.perDay - rows.length) : UNLIMITED_REMAINING,
      releaseAfterSeconds: rows.map(row => Number(row.releaseAfterSeconds)),
    };
  }
  async create(job: Pick<ImageGeneration, 'id'|'userId'|'dispatcherUserId'|'prompt'|'conversationId'>): Promise<ImageGeneration> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query('SELECT id FROM users WHERE id=? FOR UPDATE', [job.userId]);
      const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS total, SUM(status IN ('queued','running')) AS active FROM image_generation_jobs WHERE user_id=? AND created_at >= UTC_TIMESTAMP() - INTERVAL 1 DAY`, [job.userId]);
      const { maxActive, perDay } = this.limits;
      if (maxActive > 0 && Number(rows[0]?.active) >= maxActive) throw new ImageGenerationError(429, `Лимит: не больше ${maxActive} генераций одновременно`);
      if (perDay > 0 && Number(rows[0]?.total) >= perDay) throw new ImageGenerationError(429, `Лимит: ${perDay} генераций за сутки`);
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
  async listFailures(q: ImageGenerationFailureQuery): Promise<ImageGenerationFailure[]> {
    await this.expire();
    const where = ["j.status='failed'", 'j.created_at >= UTC_TIMESTAMP(3) - INTERVAL ? HOUR'];
    const params: unknown[] = [q.hours];
    if (q.userId) { where.push('j.user_id=?'); params.push(q.userId); }
    const text = q.query?.trim();
    if (text) {
      const like = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push('(j.prompt LIKE ? OR j.error_message LIKE ? OR u.email LIKE ? OR u.display_name LIKE ?)');
      params.push(like, like, like, like);
    }
    params.push(q.limit);
    const cols = fields.split(', ').map((f) => `j.${f}`).join(', ');
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${cols}, u.email AS userEmail, u.display_name AS userName
       FROM image_generation_jobs j LEFT JOIN users u ON u.id=j.user_id
       WHERE ${where.join(' AND ')} ORDER BY j.created_at DESC LIMIT ?`, params);
    return rows as ImageGenerationFailure[];
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
