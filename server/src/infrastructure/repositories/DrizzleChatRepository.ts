import { and, asc, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import {
  users,
  workspaces,
  workspaceMembers,
  workspaceChatMessages,
  workspaceChatReactions,
  workspaceChatReads,
  workspaceChatAttachments,
} from '../db/schema.js';
import type { ChatMessageRecord } from '../../domain/chat/ChatMessage.js';
import type { ChatReaction } from '../../domain/chat/ChatReaction.js';
import type { ChatAttachment } from '../../domain/chat/ChatAttachment.js';
import type {
  ChatRepository,
  ChatRoomRow,
  InsertMessageInput,
  InsertAttachmentInput,
  ListMessagesQuery,
} from '../../application/chat/ChatRepository.js';

type JoinedRow = {
  readonly m: typeof workspaceChatMessages.$inferSelect;
  readonly authorDisplayName: string;
  readonly authorAvatarUrl: string | null;
};

function toRecord(r: JoinedRow): ChatMessageRecord {
  return {
    id: r.m.id,
    seq: Number(r.m.seq),
    workspaceId: r.m.workspaceId,
    authorUserId: r.m.authorUserId,
    body: r.m.body,
    replyToId: r.m.replyToId ?? null,
    createdAt: r.m.createdAt,
    editedAt: r.m.editedAt ?? null,
    deletedAt: r.m.deletedAt ?? null,
    authorDisplayName: r.authorDisplayName,
    authorAvatarUrl: r.authorAvatarUrl ?? null,
  };
}

export class DrizzleChatRepository implements ChatRepository {
  constructor(private readonly db: Database) {}

  private baseSelect() {
    return this.db
      .select({
        m: workspaceChatMessages,
        authorDisplayName: users.displayName,
        authorAvatarUrl: users.avatarUrl,
      })
      .from(workspaceChatMessages)
      .innerJoin(users, eq(users.id, workspaceChatMessages.authorUserId));
  }

  async insertMessage(input: InsertMessageInput): Promise<ChatMessageRecord> {
    await this.db.insert(workspaceChatMessages).values({
      id: input.id,
      workspaceId: input.workspaceId,
      authorUserId: input.authorUserId,
      body: input.body,
      replyToId: input.replyToId,
    });
    const record = await this.getById(input.id);
    if (!record) throw new Error('Failed to read back chat message after insert');
    return record;
  }

  async getById(id: string): Promise<ChatMessageRecord | null> {
    const rows = await this.baseSelect().where(eq(workspaceChatMessages.id, id)).limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async getByIds(ids: readonly string[]): Promise<ChatMessageRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.baseSelect().where(inArray(workspaceChatMessages.id, [...ids]));
    return rows.map(toRecord);
  }

  async listMessages(workspaceId: string, query: ListMessagesQuery): Promise<ChatMessageRecord[]> {
    const wsFilter = eq(workspaceChatMessages.workspaceId, workspaceId);

    if (query.afterSeq !== undefined) {
      // Догон/replay: новее курсора, по возрастанию.
      const rows = await this.baseSelect()
        .where(and(wsFilter, gt(workspaceChatMessages.seq, query.afterSeq)))
        .orderBy(asc(workspaceChatMessages.seq))
        .limit(query.limit);
      return rows.map(toRecord);
    }

    // Последняя страница или скролл вверх (beforeSeq): берём DESC и разворачиваем в ASC.
    const where =
      query.beforeSeq !== undefined
        ? and(wsFilter, lt(workspaceChatMessages.seq, query.beforeSeq))
        : wsFilter;
    const rows = await this.baseSelect()
      .where(where)
      .orderBy(desc(workspaceChatMessages.seq))
      .limit(query.limit);
    return rows.map(toRecord).reverse();
  }

  async updateBody(id: string, body: string, editedAt: Date): Promise<void> {
    await this.db
      .update(workspaceChatMessages)
      .set({ body, editedAt })
      .where(eq(workspaceChatMessages.id, id));
  }

  async softDelete(id: string, deletedAt: Date): Promise<void> {
    // Тело очищаем в БД — tombstone не должен хранить исходный текст.
    await this.db
      .update(workspaceChatMessages)
      .set({ deletedAt, body: '' })
      .where(eq(workspaceChatMessages.id, id));
  }

  async addReaction(messageId: string, userId: string, emoji: string): Promise<void> {
    // INSERT IGNORE — повтор той же реакции идемпотентен (PK дубликат глотаем).
    await this.db.insert(workspaceChatReactions).values({ messageId, userId, emoji }).onDuplicateKeyUpdate({
      set: { messageId },
    });
  }

  async removeReaction(messageId: string, userId: string, emoji: string): Promise<void> {
    await this.db
      .delete(workspaceChatReactions)
      .where(
        and(
          eq(workspaceChatReactions.messageId, messageId),
          eq(workspaceChatReactions.userId, userId),
          eq(workspaceChatReactions.emoji, emoji),
        ),
      );
  }

  async listReactions(messageIds: readonly string[]): Promise<ChatReaction[]> {
    if (messageIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(workspaceChatReactions)
      .where(inArray(workspaceChatReactions.messageId, [...messageIds]));
    return rows.map((r) => ({ messageId: r.messageId, userId: r.userId, emoji: r.emoji }));
  }

  async insertAttachment(input: InsertAttachmentInput): Promise<ChatAttachment> {
    await this.db.insert(workspaceChatAttachments).values({
      id: input.id,
      messageId: input.messageId,
      storageKey: input.storageKey,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      width: input.width,
      height: input.height,
    });
    const att = await this.getAttachment(input.id);
    if (!att) throw new Error('Failed to read back chat attachment after insert');
    return att;
  }

  async getAttachment(id: string): Promise<ChatAttachment | null> {
    const rows = await this.db
      .select()
      .from(workspaceChatAttachments)
      .where(eq(workspaceChatAttachments.id, id))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      messageId: r.messageId,
      storageKey: r.storageKey,
      filename: r.filename,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      width: r.width ?? null,
      height: r.height ?? null,
    };
  }

  async listAttachments(messageIds: readonly string[]): Promise<ChatAttachment[]> {
    if (messageIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(workspaceChatAttachments)
      .where(inArray(workspaceChatAttachments.messageId, [...messageIds]));
    return rows.map((r) => ({
      id: r.id,
      messageId: r.messageId,
      storageKey: r.storageKey,
      filename: r.filename,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      width: r.width ?? null,
      height: r.height ?? null,
    }));
  }

  async getLastReadSeq(workspaceId: string, userId: string): Promise<number> {
    const rows = await this.db
      .select({ seq: workspaceChatReads.lastReadSeq })
      .from(workspaceChatReads)
      .where(
        and(eq(workspaceChatReads.workspaceId, workspaceId), eq(workspaceChatReads.userId, userId)),
      )
      .limit(1);
    return Number(rows[0]?.seq ?? 0);
  }

  async setLastReadSeq(workspaceId: string, userId: string, seq: number): Promise<void> {
    await this.db
      .insert(workspaceChatReads)
      .values({ workspaceId, userId, lastReadSeq: seq })
      .onDuplicateKeyUpdate({ set: { lastReadSeq: seq } });
  }

  async countUnread(workspaceId: string, userId: string): Promise<number> {
    const lastRead = await this.getLastReadSeq(workspaceId, userId);
    const rows = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(workspaceChatMessages)
      .where(
        and(
          eq(workspaceChatMessages.workspaceId, workspaceId),
          gt(workspaceChatMessages.seq, lastRead),
          sql`${workspaceChatMessages.authorUserId} <> ${userId}`,
          sql`${workspaceChatMessages.deletedAt} IS NULL`,
        ),
      );
    return Number(rows[0]?.count ?? 0);
  }

  async maxSeq(workspaceId: string): Promise<number> {
    const rows = await this.db
      .select({ max: sql<number>`MAX(${workspaceChatMessages.seq})` })
      .from(workspaceChatMessages)
      .where(eq(workspaceChatMessages.workspaceId, workspaceId));
    return Number(rows[0]?.max ?? 0);
  }

  async listChatRoomsForUser(userId: string): Promise<ChatRoomRow[]> {
    // Все пространства, где юзер — участник, + метаданные комнаты. memberCount/кол-во и
    // последний seq сообщений — коррелированными подзапросами (по неудалённым). Фильтр
    // «показывать ли комнату» — в ChatService.listRooms.
    const rows = await this.db
      .select({
        workspaceId: workspaces.id,
        name: workspaces.name,
        kind: workspaces.kind,
        ownerUserId: workspaces.ownerUserId,
        role: workspaceMembers.role,
        memberCount: sql<number>`(SELECT COUNT(*) FROM workspace_members wm2 WHERE wm2.workspace_id = ${workspaces.id})`,
        messageCount: sql<number>`(SELECT COUNT(*) FROM workspace_chat_messages cm WHERE cm.workspace_id = ${workspaces.id} AND cm.deleted_at IS NULL)`,
        lastMessageSeq: sql<number>`(SELECT COALESCE(MAX(cm.seq), 0) FROM workspace_chat_messages cm WHERE cm.workspace_id = ${workspaces.id} AND cm.deleted_at IS NULL)`,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, userId));
    return rows.map((r) => ({
      workspaceId: r.workspaceId,
      name: r.name,
      kind: r.kind,
      ownerUserId: r.ownerUserId,
      role: r.role,
      memberCount: Number(r.memberCount),
      messageCount: Number(r.messageCount),
      lastMessageSeq: Number(r.lastMessageSeq),
    }));
  }
}
