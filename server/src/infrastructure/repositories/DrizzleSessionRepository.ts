import { eq, lte } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { sessions, type SessionRow } from '../db/schema.js';
import type { Session } from '../../domain/session/Session.js';
import type {
  CreateSessionInput,
  SessionRepository,
} from '../../application/session/SessionRepository.js';

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.userId,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

export class DrizzleSessionRepository implements SessionRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateSessionInput): Promise<Session> {
    await this.db.insert(sessions).values({
      id: input.id,
      userId: input.userId,
      expiresAt: input.expiresAt,
    });
    const rows = await this.db.select().from(sessions).where(eq(sessions.id, input.id)).limit(1);
    const row = rows[0];
    if (!row) throw new Error('Failed to read back session after insert');
    return toSession(row);
  }

  async getById(id: string): Promise<Session | null> {
    const rows = await this.db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
    const row = rows[0];
    return row ? toSession(row) : null;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, id));
  }

  async deleteAllForUser(userId: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.userId, userId));
  }

  async deleteExpired(): Promise<number> {
    const now = new Date();
    const result = await this.db.delete(sessions).where(lte(sessions.expiresAt, now));
    // drizzle для mysql2 возвращает { affectedRows } в первом элементе
    const affected = (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
    return affected;
  }
}
