import { createHash } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { passwordResetTokens } from '../db/schema.js';
import type {
  PasswordResetTokenLookup,
  PasswordResetTokenRepository,
} from '../../application/auth/PasswordResetTokenRepository.js';

// SHA-256(token) в hex — то, что кладём в token_hash. Plaintext-токен нигде не хранится.
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class DrizzlePasswordResetTokenRepository implements PasswordResetTokenRepository {
  constructor(private readonly db: Database) {}

  async create(input: {
    id: string;
    userId: string;
    token: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.db.insert(passwordResetTokens).values({
      id: input.id,
      userId: input.userId,
      tokenHash: hashToken(input.token),
      expiresAt: input.expiresAt,
    });
  }

  async findValidByToken(token: string, now: Date): Promise<PasswordResetTokenLookup | null> {
    const rows = await this.db
      .select({ id: passwordResetTokens.id, userId: passwordResetTokens.userId })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, hashToken(token)),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, now),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async markUsed(id: string, at: Date): Promise<void> {
    await this.db
      .update(passwordResetTokens)
      .set({ usedAt: at })
      .where(eq(passwordResetTokens.id, id));
  }

  async deleteAllForUser(userId: string): Promise<void> {
    await this.db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
  }
}
