import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import {
  telegramGroupOnboardings,
  telegramPairingTokens,
  users,
  type TelegramGroupOnboardingRow,
} from '../db/schema.js';
import type {
  GroupOnboarding,
  GroupOnboardingPatch,
  TelegramGroupOnboardingRepository,
  TelegramLinkOutcome,
} from '../../application/telegram/TelegramGroupOnboardingRepository.js';

function toOnboarding(row: TelegramGroupOnboardingRow): GroupOnboarding {
  return {
    id: row.id,
    tgChatId: row.tgChatId,
    workspaceId: row.workspaceId,
    tgUserId: row.tgUserId,
    tgUsername: row.tgUsername ?? null,
    tgFirstName: row.tgFirstName ?? null,
    senderName: row.senderName,
    groupTitle: row.groupTitle ?? null,
    pendingText: row.pendingText ?? null,
    lastSourceKey: row.lastSourceKey ?? null,
    status: row.status,
    inviteId: row.inviteId ?? null,
    promptedAt: row.promptedAt ?? null,
    expiresAt: row.expiresAt,
  };
}

function isDuplicateKey(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return (e.cause?.code ?? e.code) === 'ER_DUP_ENTRY';
}

export class DrizzleTelegramGroupOnboardingRepository implements TelegramGroupOnboardingRepository {
  constructor(private readonly db: Database) {}

  async findOpen(tgChatId: number, tgUserId: number, now: Date): Promise<GroupOnboarding | null> {
    const [row] = await this.db
      .select()
      .from(telegramGroupOnboardings)
      .where(
        and(
          eq(telegramGroupOnboardings.tgChatId, tgChatId),
          eq(telegramGroupOnboardings.tgUserId, tgUserId),
          ne(telegramGroupOnboardings.status, 'completed'),
          gt(telegramGroupOnboardings.expiresAt, now),
        ),
      )
      .orderBy(desc(telegramGroupOnboardings.createdAt))
      .limit(1);
    return row ? toOnboarding(row) : null;
  }

  async getById(id: string): Promise<GroupOnboarding | null> {
    const [row] = await this.db
      .select()
      .from(telegramGroupOnboardings)
      .where(eq(telegramGroupOnboardings.id, id))
      .limit(1);
    return row ? toOnboarding(row) : null;
  }

  async findByInvite(inviteId: string): Promise<GroupOnboarding | null> {
    const [row] = await this.db
      .select()
      .from(telegramGroupOnboardings)
      .where(eq(telegramGroupOnboardings.inviteId, inviteId))
      .limit(1);
    return row ? toOnboarding(row) : null;
  }

  async create(o: GroupOnboarding): Promise<void> {
    await this.db.insert(telegramGroupOnboardings).values({
      id: o.id,
      tgChatId: o.tgChatId,
      workspaceId: o.workspaceId,
      tgUserId: o.tgUserId,
      tgUsername: o.tgUsername,
      tgFirstName: o.tgFirstName,
      senderName: o.senderName,
      groupTitle: o.groupTitle,
      pendingText: o.pendingText,
      lastSourceKey: o.lastSourceKey,
      status: o.status,
      inviteId: o.inviteId,
      promptedAt: o.promptedAt,
      expiresAt: o.expiresAt,
    });
  }

  async update(id: string, patch: GroupOnboardingPatch): Promise<void> {
    if (Object.keys(patch).length === 0) return;
    await this.db.update(telegramGroupOnboardings).set(patch).where(eq(telegramGroupOnboardings.id, id));
  }

  async claimCompletion(id: string): Promise<boolean> {
    const [result] = await this.db
      .update(telegramGroupOnboardings)
      .set({ status: 'completed' })
      .where(and(eq(telegramGroupOnboardings.id, id), ne(telegramGroupOnboardings.status, 'completed')));
    return result.affectedRows > 0;
  }

  async linkTelegram(
    userId: string,
    telegram: { readonly id: number; readonly username: string | null; readonly firstName: string | null },
    now: Date,
  ): Promise<TelegramLinkOutcome> {
    try {
      return await this.db.transaction(async (tx) => {
        const [user] = await tx
          .select({ telegramUserId: users.telegramUserId })
          .from(users)
          .where(eq(users.id, userId))
          .for('update');
        if (!user) return 'conflict';
        if (user.telegramUserId !== null) return user.telegramUserId === telegram.id ? 'same' : 'conflict';
        const [owner] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.telegramUserId, telegram.id))
          .limit(1);
        if (owner) return 'conflict';
        // Человек нажимал Start у бота, поэтому личный чат открыт: tg_chat_id = его Telegram id.
        await tx
          .update(users)
          .set({
            telegramUserId: telegram.id,
            telegramUsername: telegram.username,
            telegramFirstName: telegram.firstName,
            telegramPhotoUrl: null,
            telegramAuthDate: now,
            tgChatId: telegram.id,
            tgStartedAt: now,
            tgPairedAt: now,
          })
          .where(and(eq(users.id, userId), isNull(users.telegramUserId)));
        await tx.delete(telegramPairingTokens).where(eq(telegramPairingTokens.userId, userId));
        return 'connected';
      });
    } catch (error) {
      // Тот же Telegram параллельно привязали к другому аккаунту — уникальный индекс.
      if (isDuplicateKey(error)) return 'conflict';
      throw error;
    }
  }
}
