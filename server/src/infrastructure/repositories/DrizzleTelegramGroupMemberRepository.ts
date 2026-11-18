import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { telegramGroupMembers, users } from '../db/schema.js';
import type {
  LinkedTelegramGroupMember,
  TelegramGroupMemberRepository,
  TelegramGroupMemberSighting,
} from '../../application/telegram/TelegramGroupMemberRepository.js';

export class DrizzleTelegramGroupMemberRepository implements TelegramGroupMemberRepository {
  constructor(private readonly db: Database) {}

  async upsert(sighting: TelegramGroupMemberSighting): Promise<void> {
    // Автор сообщения статус не знает: администратор остаётся администратором, вышедший
    // (left) снова в группе — участник. Явный статус события перезаписывает.
    const status = sighting.status ?? 'member';
    const statusOnUpdate = sighting.status
      ? sighting.status
      : sql<'member' | 'admin' | 'left'>`IF(${telegramGroupMembers.status} = 'left', 'member', ${telegramGroupMembers.status})`;
    await this.db
      .insert(telegramGroupMembers)
      .values({
        tgChatId: sighting.chatId,
        tgUserId: sighting.tgUserId,
        status,
        source: sighting.source,
        seenAt: sighting.seenAt,
      })
      .onDuplicateKeyUpdate({
        set: {
          status: statusOnUpdate,
          source: sighting.source,
          seenAt: sighting.seenAt,
        },
      });
  }

  async summary(
    chatId: number,
  ): Promise<{ readonly telegramCount: number; readonly linked: LinkedTelegramGroupMember[] }> {
    const present = and(eq(telegramGroupMembers.tgChatId, chatId), ne(telegramGroupMembers.status, 'left'));
    const [countRow] = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(telegramGroupMembers)
      .where(present);
    const rows = await this.db
      .select({
        tgUserId: telegramGroupMembers.tgUserId,
        status: telegramGroupMembers.status,
        userId: users.id,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
      })
      .from(telegramGroupMembers)
      .innerJoin(users, eq(users.telegramUserId, telegramGroupMembers.tgUserId))
      .where(present)
      .orderBy(asc(users.displayName));
    return {
      telegramCount: Number(countRow?.count ?? 0),
      linked: rows.map((r) => ({
        tgUserId: r.tgUserId,
        userId: r.userId,
        displayName: r.displayName,
        avatarUrl: r.avatarUrl ?? null,
        status: r.status === 'admin' ? 'admin' : 'member',
      })),
    };
  }
}
