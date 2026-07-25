import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import type {
  CommitSyncBatchProgress,
  CommitSyncBatchProgressRepository,
} from '../../application/commit-sync/CommitSyncBatchProgressRepository.js';
import { commitSyncBatchProgress } from '../db/schema.js';

export class DrizzleCommitSyncBatchProgressRepository
  implements CommitSyncBatchProgressRepository
{
  constructor(private readonly db: Database) {}

  async tryClaim(batchKey: string, chatId: number): Promise<boolean> {
    // Атомарный claim по PK: INSERT IGNORE вставит строку только если batch_key ещё не занят.
    // affectedRows=1 → застолбили (шлём прогресс); 0 → прогресс уже начат (гонка enqueue) → молчок.
    const result = await this.db.execute(sql`
      INSERT IGNORE INTO commit_sync_batch_progress (batch_key, chat_id)
      VALUES (${batchKey}, ${chatId})
    `);
    return affectedRows(result) > 0;
  }

  async setMessageId(batchKey: string, messageId: number): Promise<void> {
    await this.db
      .update(commitSyncBatchProgress)
      .set({ messageId })
      .where(eq(commitSyncBatchProgress.batchKey, batchKey));
  }

  async get(batchKey: string): Promise<CommitSyncBatchProgress | null> {
    const [row] = await this.db
      .select()
      .from(commitSyncBatchProgress)
      .where(eq(commitSyncBatchProgress.batchKey, batchKey))
      .limit(1);
    if (!row) return null;
    return { chatId: row.chatId, messageId: row.messageId ?? null };
  }

  async delete(batchKey: string): Promise<void> {
    await this.db
      .delete(commitSyncBatchProgress)
      .where(eq(commitSyncBatchProgress.batchKey, batchKey));
  }
}

// mysql2 возвращает [ResultSetHeader, FieldPacket[]] для INSERT — читаем affectedRows.
function affectedRows(result: unknown): number {
  return (result as [{ affectedRows?: number }])[0]?.affectedRows ?? 0;
}
