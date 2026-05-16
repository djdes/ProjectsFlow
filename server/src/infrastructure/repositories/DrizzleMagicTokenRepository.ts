import { and, eq, gte, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { magicTokens, type MagicTokenRow } from '../db/schema.js';
import type {
  CreateMagicTokenInput,
  MagicToken,
  MagicTokenRepository,
} from '../../application/auth/MagicTokenRepository.js';

function toMagicToken(row: MagicTokenRow): MagicToken {
  return {
    id: row.id,
    email: row.email,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt ?? null,
    createdAt: row.createdAt,
  };
}

export class DrizzleMagicTokenRepository implements MagicTokenRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateMagicTokenInput): Promise<MagicToken> {
    await this.db.insert(magicTokens).values({
      id: input.id,
      email: input.email,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
    });
    const rows = await this.db.select().from(magicTokens).where(eq(magicTokens.id, input.id)).limit(1);
    const row = rows[0];
    if (!row) throw new Error('Failed to read back magic token after insert');
    return toMagicToken(row);
  }

  async findByHash(tokenHash: string): Promise<MagicToken | null> {
    const rows = await this.db
      .select()
      .from(magicTokens)
      .where(eq(magicTokens.tokenHash, tokenHash))
      .limit(1);
    const row = rows[0];
    return row ? toMagicToken(row) : null;
  }

  async markConsumed(id: string, at: Date): Promise<void> {
    await this.db.update(magicTokens).set({ consumedAt: at }).where(eq(magicTokens.id, id));
  }

  async countRecentForEmail(email: string, since: Date): Promise<number> {
    const rows = await this.db
      .select({ c: sql<number>`COUNT(*)` })
      .from(magicTokens)
      .where(and(eq(magicTokens.email, email), gte(magicTokens.createdAt, since)));
    return Number(rows[0]?.c ?? 0);
  }

  async deleteExpired(): Promise<number> {
    const now = new Date();
    const result = await this.db.delete(magicTokens).where(sql`${magicTokens.expiresAt} <= ${now}`);
    const affected = (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
    return affected;
  }
}
