import { and, desc, eq, gt, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { telegramGroupOnboardings, type TelegramGroupOnboardingRow } from '../db/schema.js';
import type {
  GroupOnboarding,
  GroupOnboardingPatch,
  TelegramGroupOnboardingRepository,
} from '../../application/telegram/TelegramGroupOnboardingRepository.js';

// Открытые записи: человек ещё не подключился, а группу не отключали.
const OPEN_STATUSES = ['pending', 'invited'] as const;

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
          inArray(telegramGroupOnboardings.status, [...OPEN_STATUSES]),
          gt(telegramGroupOnboardings.expiresAt, now),
        ),
      )
      .orderBy(desc(telegramGroupOnboardings.createdAt))
      .limit(1);
    return row ? toOnboarding(row) : null;
  }

  async listOpenForTelegramUser(tgUserId: number, now: Date): Promise<GroupOnboarding[]> {
    const rows = await this.db
      .select()
      .from(telegramGroupOnboardings)
      .where(
        and(
          eq(telegramGroupOnboardings.tgUserId, tgUserId),
          inArray(telegramGroupOnboardings.status, [...OPEN_STATUSES]),
          gt(telegramGroupOnboardings.expiresAt, now),
        ),
      )
      .orderBy(desc(telegramGroupOnboardings.createdAt))
      .limit(20);
    return rows.map(toOnboarding);
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

  async setInviteIfAbsent(id: string, inviteId: string): Promise<string | null> {
    await this.db
      .update(telegramGroupOnboardings)
      .set({ inviteId, status: 'invited' })
      .where(
        and(
          eq(telegramGroupOnboardings.id, id),
          isNull(telegramGroupOnboardings.inviteId),
          inArray(telegramGroupOnboardings.status, [...OPEN_STATUSES]),
        ),
      );
    return (await this.getById(id))?.inviteId ?? null;
  }

  async claimCompletion(id: string): Promise<boolean> {
    const [result] = await this.db
      .update(telegramGroupOnboardings)
      .set({ status: 'completed' })
      .where(and(eq(telegramGroupOnboardings.id, id), inArray(telegramGroupOnboardings.status, [...OPEN_STATUSES])));
    return result.affectedRows > 0;
  }

  async cancelOpenForGroup(workspaceId: string, tgChatId: number): Promise<string[]> {
    return this.db.transaction(async (tx) => {
      const where = and(
        eq(telegramGroupOnboardings.workspaceId, workspaceId),
        eq(telegramGroupOnboardings.tgChatId, tgChatId),
        inArray(telegramGroupOnboardings.status, [...OPEN_STATUSES]),
      );
      const invites = await tx
        .select({ inviteId: telegramGroupOnboardings.inviteId })
        .from(telegramGroupOnboardings)
        .where(and(where, isNotNull(telegramGroupOnboardings.inviteId)))
        .for('update');
      await tx.update(telegramGroupOnboardings).set({ status: 'cancelled' }).where(where);
      return invites.map((row) => row.inviteId).filter((id): id is string => id !== null);
    });
  }
}
