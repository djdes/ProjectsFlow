import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import {
  projectDigestSettings,
  projects,
  telegramGroupLinkTokens,
  telegramGroupProjects,
  telegramGroupOnboardings,
  telegramGroupOwners,
  workspaceAssigneeDigestSettings,
  workspaceTelegramGroups,
  type WorkspaceTelegramGroupRow,
} from '../db/schema.js';
import type {
  NewTelegramWorkGroup,
  TelegramGroupLinkCode,
  TelegramWorkGroup,
  TelegramWorkGroupRepository,
  TelegramWorkGroupStatus,
} from '../../application/telegram/TelegramWorkGroupRepository.js';

function toGroup(row: WorkspaceTelegramGroupRow, projectIds: readonly string[] = []): TelegramWorkGroup {
  return {
    chatId: row.tgChatId,
    workspaceId: row.workspaceId,
    title: row.title ?? null,
    addedByUserId: row.addedByUserId ?? null,
    createdAt: row.createdAt,
    status: row.status,
    invitedByTgUserId: row.invitedByTgUserId ?? null,
    projectIds,
    transfer:
      row.transferToWorkspaceId && row.transferRequestedByUserId && row.transferTargetStatus
        ? {
            toWorkspaceId: row.transferToWorkspaceId,
            requestedByUserId: row.transferRequestedByUserId,
            targetStatus: row.transferTargetStatus,
            requestedAt: row.transferRequestedAt ?? row.createdAt,
          }
        : null,
  };
}

const NO_TRANSFER = {
  transferToWorkspaceId: null,
  transferRequestedByUserId: null,
  transferTargetStatus: null,
  transferRequestedAt: null,
} as const;

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
    if (rows.length === 0) return [];
    const byChat = await this.projectIdsByChat(rows.map((r) => r.tgChatId), workspaceId);
    return rows.map((row) => toGroup(row, byChat.get(row.tgChatId) ?? []));
  }

  // Проекты групп — только те, что ещё лежат в пространстве группы: перенос проекта в другое
  // пространство молча убирает его из группы (spec §2).
  private async projectIdsByChat(chatIds: readonly number[], workspaceId: string): Promise<Map<number, string[]>> {
    const links = await this.db
      .select({ chatId: telegramGroupProjects.tgChatId, projectId: telegramGroupProjects.projectId })
      .from(telegramGroupProjects)
      .innerJoin(projects, eq(projects.id, telegramGroupProjects.projectId))
      .where(and(inArray(telegramGroupProjects.tgChatId, [...chatIds]), eq(projects.workspaceId, workspaceId)))
      .orderBy(asc(telegramGroupProjects.createdAt));
    const out = new Map<number, string[]>();
    for (const link of links) {
      const list = out.get(link.chatId) ?? [];
      list.push(link.projectId);
      out.set(link.chatId, list);
    }
    return out;
  }

  async findByChat(chatId: number): Promise<TelegramWorkGroup | null> {
    const [row] = await this.db
      .select()
      .from(workspaceTelegramGroups)
      .where(eq(workspaceTelegramGroups.tgChatId, chatId))
      .limit(1);
    if (!row) return null;
    const byChat = await this.projectIdsByChat([row.tgChatId], row.workspaceId);
    return toGroup(row, byChat.get(row.tgChatId) ?? []);
  }

  async insert(group: NewTelegramWorkGroup): Promise<'created' | 'exists'> {
    try {
      await this.db.insert(workspaceTelegramGroups).values({
        tgChatId: group.chatId,
        workspaceId: group.workspaceId,
        title: group.title?.slice(0, 255) ?? null,
        addedByUserId: group.addedByUserId,
        status: group.status ?? 'active',
        invitedByTgUserId: group.invitedByTgUserId ?? null,
      });
      return 'created';
    } catch (error) {
      if (isDuplicateKey(error)) return 'exists';
      throw error;
    }
  }

  async replace(group: NewTelegramWorkGroup): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ workspaceId: workspaceTelegramGroups.workspaceId })
        .from(workspaceTelegramGroups)
        .where(eq(workspaceTelegramGroups.tgChatId, group.chatId))
        .limit(1)
        .for('update');
      if (row && row.workspaceId !== group.workspaceId) {
        await tx.delete(telegramGroupProjects).where(eq(telegramGroupProjects.tgChatId, group.chatId));
      }
      await tx
        .update(workspaceTelegramGroups)
        .set({
          workspaceId: group.workspaceId,
          addedByUserId: group.addedByUserId,
          status: group.status ?? 'active',
          ...NO_TRANSFER,
          ...(group.title ? { title: group.title.slice(0, 255) } : {}),
          ...(group.invitedByTgUserId !== undefined ? { invitedByTgUserId: group.invitedByTgUserId } : {}),
        })
        .where(eq(workspaceTelegramGroups.tgChatId, group.chatId));
    });
  }

  async requestTransfer(
    chatId: number,
    transfer: { toWorkspaceId: string; requestedByUserId: string; targetStatus: 'draft' | 'active' },
  ): Promise<void> {
    await this.db
      .update(workspaceTelegramGroups)
      .set({
        transferToWorkspaceId: transfer.toWorkspaceId,
        transferRequestedByUserId: transfer.requestedByUserId,
        transferTargetStatus: transfer.targetStatus,
        transferRequestedAt: new Date(),
      })
      .where(eq(workspaceTelegramGroups.tgChatId, chatId));
  }

  async clearTransfer(chatId: number): Promise<void> {
    await this.db
      .update(workspaceTelegramGroups)
      .set(NO_TRANSFER)
      .where(eq(workspaceTelegramGroups.tgChatId, chatId));
  }

  async setStatus(chatId: number, status: TelegramWorkGroupStatus): Promise<void> {
    await this.db
      .update(workspaceTelegramGroups)
      .set({ status })
      .where(eq(workspaceTelegramGroups.tgChatId, chatId));
  }

  async setProjects(chatId: number, projectIds: readonly string[], actorUserId: string): Promise<void> {
    const unique = [...new Set(projectIds)];
    await this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ projectId: telegramGroupProjects.projectId })
        .from(telegramGroupProjects)
        .where(eq(telegramGroupProjects.tgChatId, chatId));
      const keep = new Set(unique);
      const stale = existing.map((r) => r.projectId).filter((id) => !keep.has(id));
      if (stale.length > 0) {
        await tx
          .delete(telegramGroupProjects)
          .where(and(eq(telegramGroupProjects.tgChatId, chatId), inArray(telegramGroupProjects.projectId, stale)));
      }
      const have = new Set(existing.map((r) => r.projectId));
      const added = unique.filter((id) => !have.has(id));
      if (added.length > 0) {
        await tx
          .insert(telegramGroupProjects)
          .values(added.map((projectId) => ({ tgChatId: chatId, projectId, addedByUserId: actorUserId })));
      }
    });
  }

  async listActiveProjectIds(chatId: number): Promise<string[]> {
    const rows = await this.db
      .select({ projectId: telegramGroupProjects.projectId })
      .from(telegramGroupProjects)
      .innerJoin(workspaceTelegramGroups, eq(workspaceTelegramGroups.tgChatId, telegramGroupProjects.tgChatId))
      .innerJoin(projects, eq(projects.id, telegramGroupProjects.projectId))
      .where(
        and(
          eq(telegramGroupProjects.tgChatId, chatId),
          eq(workspaceTelegramGroups.status, 'active'),
          eq(projects.workspaceId, workspaceTelegramGroups.workspaceId),
        ),
      )
      .orderBy(asc(telegramGroupProjects.createdAt));
    return rows.map((r) => r.projectId);
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
      await tx
        .update(projectDigestSettings)
        .set({ telegramGroupChatId: toChatId })
        .where(eq(projectDigestSettings.telegramGroupChatId, fromChatId));
      await tx
        .update(telegramGroupOnboardings)
        .set({ tgChatId: toChatId })
        .where(eq(telegramGroupOnboardings.tgChatId, fromChatId));
      // Владелец группы (db/099): PK по чату — если у нового id уже есть владелец, старый лишний.
      const [ownerTaken] = await tx
        .select({ chatId: telegramGroupOwners.tgChatId })
        .from(telegramGroupOwners)
        .where(eq(telegramGroupOwners.tgChatId, toChatId))
        .limit(1);
      if (ownerTaken) {
        await tx.delete(telegramGroupOwners).where(eq(telegramGroupOwners.tgChatId, fromChatId));
      } else {
        await tx
          .update(telegramGroupOwners)
          .set({ tgChatId: toChatId })
          .where(eq(telegramGroupOwners.tgChatId, fromChatId));
      }
    });
  }

  async getMainGroup(workspaceId: string): Promise<{ chatId: number; title: string | null } | null> {
    const [row] = await this.db
      .select({
        chatId: workspaceAssigneeDigestSettings.telegramGroupChatId,
        title: workspaceAssigneeDigestSettings.telegramGroupTitle,
      })
      .from(workspaceAssigneeDigestSettings)
      .where(eq(workspaceAssigneeDigestSettings.workspaceId, workspaceId))
      .limit(1);
    return row?.chatId != null ? { chatId: row.chatId, title: row.title ?? null } : null;
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
