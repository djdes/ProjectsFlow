import { sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import type { DesktopNoteApp, DesktopNoteRepository } from '../../application/desktop-notes/DesktopNoteRepository.js';

export class DrizzleDesktopNoteRepository implements DesktopNoteRepository {
  constructor(private readonly db: Database) {}

  async listPinnedTaskIds(userId: string): Promise<string[]> {
    const result = await this.db.execute(sql`
      SELECT task_id FROM desktop_note_pins WHERE user_id = ${userId} ORDER BY created_at, task_id`);
    return (result[0] as unknown as Array<{ task_id: string }>).map((r) => String(r.task_id));
  }

  async pin(userId: string, taskId: string): Promise<void> {
    await this.db.execute(sql`
      INSERT IGNORE INTO desktop_note_pins (user_id, task_id) VALUES (${userId}, ${taskId})`);
  }

  async unpin(userId: string, taskId: string): Promise<void> {
    await this.db.execute(sql`DELETE FROM desktop_note_pins WHERE user_id = ${userId} AND task_id = ${taskId}`);
  }

  async touchApp(userId: string, appVersion: string | null): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO desktop_note_apps (user_id, last_seen_at, app_version)
      VALUES (${userId}, CURRENT_TIMESTAMP, ${appVersion})
      ON DUPLICATE KEY UPDATE last_seen_at = CURRENT_TIMESTAMP, app_version = VALUES(app_version)`);
  }

  async getApp(userId: string): Promise<DesktopNoteApp | null> {
    const result = await this.db.execute(sql`
      SELECT last_seen_at, app_version FROM desktop_note_apps WHERE user_id = ${userId}`);
    const row = (result[0] as unknown as Array<{ last_seen_at: Date | string; app_version: string | null }>)[0];
    if (!row) return null;
    const seen = row.last_seen_at instanceof Date ? row.last_seen_at : new Date(`${row.last_seen_at}Z`);
    return { lastSeenAt: seen, appVersion: row.app_version };
  }
}
