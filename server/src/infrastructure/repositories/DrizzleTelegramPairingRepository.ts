import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { telegramPairingTokens as tokens, users } from '../db/schema.js';
import type { TelegramPairingRepository, TelegramPairingResult } from '../../application/telegram/TelegramPairingRepository.js';

export class DrizzleTelegramPairingRepository implements TelegramPairingRepository {
  constructor(private readonly db: Database) {}

  async issue(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [user] = await tx.select({ telegramUserId: users.telegramUserId }).from(users)
        .where(eq(users.id, input.userId)).for('update');
      if (!user || user.telegramUserId !== null) return false;
      await tx.insert(tokens).values(input).onDuplicateKeyUpdate({
        set: { tokenHash: input.tokenHash, expiresAt: input.expiresAt },
      });
      return true;
    });
  }

  async complete(input: Parameters<TelegramPairingRepository['complete']>[0]): Promise<TelegramPairingResult> {
    try {
      return await this.db.transaction(async (tx) => {
        const [candidate] = await tx.select({ userId: tokens.userId }).from(tokens)
          .where(eq(tokens.tokenHash, input.tokenHash)).limit(1);
        if (!candidate) return 'expired';
        // Lock in the same order as issue: user, then token. Recheck the token after the lock.
        const [user] = await tx.select({ telegramUserId: users.telegramUserId }).from(users)
          .where(eq(users.id, candidate.userId)).for('update');
        const [token] = await tx.select().from(tokens).where(and(
          eq(tokens.userId, candidate.userId), eq(tokens.tokenHash, input.tokenHash),
          gt(tokens.expiresAt, input.now),
        )).for('update');
        if (!user || !token) return 'expired';
        if (user.telegramUserId !== null) return 'already_linked';
        const [owner] = await tx.select({ id: users.id }).from(users)
          .where(eq(users.telegramUserId, input.telegramUserId)).limit(1);
        if (owner) return 'already_linked';
        await tx.update(users).set({
          telegramUserId: input.telegramUserId,
          telegramUsername: input.telegramUsername,
          telegramFirstName: input.telegramFirstName,
          telegramPhotoUrl: null,
          telegramAuthDate: input.now,
          tgChatId: input.telegramUserId,
          tgStartedAt: input.now,
          tgPairedAt: input.now,
        }).where(and(eq(users.id, candidate.userId), isNull(users.telegramUserId)));
        await tx.delete(tokens).where(eq(tokens.userId, candidate.userId));
        return 'connected';
      });
    } catch (error) {
      // A simultaneous connection of this Telegram to another account loses the unique-index race.
      const cause = (error as { cause?: { code?: string }; code?: string });
      if ((cause.cause?.code ?? cause.code) === 'ER_DUP_ENTRY') return 'already_linked';
      throw error;
    }
  }

  async revoke(userId: string): Promise<void> {
    await this.db.delete(tokens).where(eq(tokens.userId, userId));
  }
}
