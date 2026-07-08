import { eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { telegramGroupOwners } from '../db/schema.js';
import type { TelegramGroupOwnerRepository } from '../../application/telegram/TelegramGroupOwnerRepository.js';

export class DrizzleTelegramGroupOwnerRepository implements TelegramGroupOwnerRepository {
  constructor(private readonly db: Database) {}

  async getOwnerUserId(tgChatId: number): Promise<string | null> {
    const rows = await this.db
      .select({ ownerUserId: telegramGroupOwners.ownerUserId })
      .from(telegramGroupOwners)
      .where(eq(telegramGroupOwners.tgChatId, tgChatId))
      .limit(1);
    return rows[0]?.ownerUserId ?? null;
  }

  async bindIfAbsent(
    tgChatId: number,
    ownerUserId: string,
  ): Promise<{ ownerUserId: string; created: boolean }> {
    const existing = await this.getOwnerUserId(tgChatId);
    if (existing) return { ownerUserId: existing, created: false };
    try {
      await this.db.insert(telegramGroupOwners).values({ tgChatId, ownerUserId });
      return { ownerUserId, created: true };
    } catch (err) {
      // Гонка: кто-то привязал между select и insert (PK-конфликт) → перечитываем владельца.
      const now = await this.getOwnerUserId(tgChatId);
      if (now) return { ownerUserId: now, created: false };
      throw err;
    }
  }
}
