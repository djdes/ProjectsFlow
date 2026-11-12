import { and, asc, eq, gt } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import {
  telegramGroupLinkTokens,
  workspaceAssigneeDigestSettings,
  workspaceTelegramGroups,
  type WorkspaceTelegramGroupRow,
} from '../db/schema.js';
import type {
  TelegramGroupLinkCode,
  TelegramWorkGroup,
  TelegramWorkGroupRepository,
} from '../../application/telegram/TelegramWorkGroupRepository.js';

function toGroup(row: WorkspaceTelegramGroupRow): TelegramWorkGroup {
  return {
    chatId: row.tgChatId,
    workspaceId: row.workspaceId,
    title: row.title ?? null,
    addedByUserId: row.addedByUserId ?? null,
    createdAt: row.createdAt,
  };
}

function isDuplicateKey(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return (e.cause?.code ?? e.code) === 'ER_DUP_ENTRY';
}

export class DrizzleTelegramWorkGroupRepository implements TelegramWorkGroupRepository {
  constructor(private readonly db: Database) {}

  async listByWorkspace(workspaceId: string): Promise<TelegramWorkGroup[]> {
    const rows = await this.db
      .select()
      .from(workspaceTelegramGroups)
      .where(eq(workspaceTelegramGroups.workspaceId, workspaceId))
      .orderBy(asc(workspaceTelegramGroups.createdAt));
    return rows.map(toGroup);
  }

  async findByChat(chatId: number): Promise<TelegramWorkGroup | null> {
    const [row] = await this.db
      .select()
      .from(workspaceTelegramGroups)
      .where(eq(workspaceTelegramGroups.tgChatId, chatId))
      .limit(1);
    return row ? toGroup(row) : null;
  }

  async insert(group: Omit<TelegramWorkGroup, 'createdAt'>): Promise<'created' | 'exists'> {
    try {
      await this.db.insert(workspaceTelegramGroups).values({
        tgChatId: group.chatId,
        workspaceId: group.workspaceId,
        title: group.title,
        addedByUserId: group.addedByUserId,
      });
      return 'created';
    } catch (error) {
      if (isDuplicateKey(error)) return 'exists';
      throw error;
    }
  }

  async updateTitle(chatId: number, title: string): Promise<void> {
    await this.db
      .update(workspaceTelegramGroups)
      .set({ title: title.slice(0, 255) })
      .where(eq(workspaceTelegramGroups.tgChatId, chatId));
  }

  async remove(workspaceId: string, chatId: number): Promise<boolean> {
    const [result] = await this.db
      .delete(workspaceTelegramGroups)
      .where(
        and(
          eq(workspaceTelegramGroups.workspaceId, workspaceId),
          eq(workspaceTelegramGroups.tgChatId, chatId),
        ),
      );
    return result.affectedRows > 0;
  }

  async migrateChat(fromChatId: number, toChatId: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Новый id мог уже появиться (бот видел супергруппу раньше) — тогда старая строка лишняя.
      const [taken] = await tx
        .select({ chatId: workspaceTelegramGroups.tgChatId })
        .from(workspaceTelegramGroups)
        .where(eq(workspaceTelegramGroups.tgChatId, toChatId))
        .limit(1);
      if (taken) {
        await tx.delete(workspaceTelegramGroups).where(eq(workspaceTelegramGroups.tgChatId, fromChatId));
      } else {
        await tx
          .update(workspaceTelegramGroups)
          .set({ tgChatId: toChatId })
          .where(eq(workspaceTelegramGroups.tgChatId, fromChatId));
      }
      await tx
        .update(workspaceAssigneeDigestSettings)
        .set({ telegramGroupChatId: toChatId })
        .where(eq(workspaceAssigneeDigestSettings.telegramGroupChatId, fromChatId));
    });
  }

  async setMainGroup(workspaceId: string, chatId: number, title: string | null): Promise<void> {
    const set = { telegramGroupChatId: chatId, telegramGroupTitle: title?.slice(0, 255) ?? null };
    await this.db
      .insert(workspaceAssigneeDigestSettings)
      .values({ workspaceId, ...set })
      .onDuplicateKeyUpdate({ set });
  }

  async issueLinkCode(
    input: TelegramGroupLinkCode & { tokenHash: string; expiresAt: Date },
  ): Promise<void> {
    await this.db.insert(telegramGroupLinkTokens).values({
      tokenHash: input.tokenHash,
      workspaceId: input.workspaceId,
      purpose: input.purpose,
      createdByUserId: input.createdByUserId,
      expiresAt: input.expiresAt,
    });
  }

  async consumeLinkCode(tokenHash: string, now: Date): Promise<TelegramGroupLinkCode | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(telegramGroupLinkTokens)
        .where(
          and(eq(telegramGroupLinkTokens.tokenHash, tokenHash), gt(telegramGroupLinkTokens.expiresAt, now)),
        )
        .limit(1)
        .for('update');
      if (!row) return null;
      await tx.delete(telegramGroupLinkTokens).where(eq(telegramGroupLinkTokens.tokenHash, tokenHash));
      return { workspaceId: row.workspaceId, purpose: row.purpose, createdByUserId: row.createdByUserId };
    });
  }
}
