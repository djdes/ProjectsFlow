import type { ChatMessageRecord } from '../../domain/chat/ChatMessage.js';
import type { ChatReaction } from '../../domain/chat/ChatReaction.js';
import type { ChatAttachment } from '../../domain/chat/ChatAttachment.js';
import type { WorkspaceKind } from '../../domain/workspace/Workspace.js';
import type { WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';

// Строка-кандидат для списка чат-комнат юзера (пространства, где он участник) — без unread,
// его добавляет ChatService через countUnread. messageCount/lastMessageSeq — по неудалённым.
export type ChatRoomRow = {
  readonly workspaceId: string;
  readonly name: string;
  readonly kind: WorkspaceKind;
  readonly ownerUserId: string;
  // Роль текущего юзера в этой комнате (owner может модерировать чужие сообщения).
  readonly role: WorkspaceRole;
  readonly memberCount: number;
  readonly messageCount: number;
  readonly lastMessageSeq: number;
};

export type InsertMessageInput = {
  readonly id: string;
  readonly workspaceId: string;
  readonly authorUserId: string;
  readonly body: string;
  readonly replyToId: string | null;
};

export type InsertAttachmentInput = {
  readonly id: string;
  readonly messageId: string;
  readonly storageKey: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly width: number | null;
  readonly height: number | null;
};

// Окно выборки ленты. Ровно один из beforeSeq/afterSeq (или ни одного — тогда последняя
// страница). beforeSeq — старее (скролл вверх), afterSeq — новее (догон/SSE-replay).
export type ListMessagesQuery = {
  readonly beforeSeq?: number;
  readonly afterSeq?: number;
  readonly limit: number;
};

export interface ChatRepository {
  insertMessage(input: InsertMessageInput): Promise<ChatMessageRecord>;
  getById(id: string): Promise<ChatMessageRecord | null>;
  getByIds(ids: readonly string[]): Promise<ChatMessageRecord[]>;
  // Всегда возвращает по возрастанию seq (старые → новые), независимо от направления окна.
  listMessages(workspaceId: string, query: ListMessagesQuery): Promise<ChatMessageRecord[]>;
  updateBody(id: string, body: string, editedAt: Date): Promise<void>;
  softDelete(id: string, deletedAt: Date): Promise<void>;

  // Идемпотентно (INSERT IGNORE): повторная та же реакция не падает.
  addReaction(messageId: string, userId: string, emoji: string): Promise<void>;
  removeReaction(messageId: string, userId: string, emoji: string): Promise<void>;
  listReactions(messageIds: readonly string[]): Promise<ChatReaction[]>;

  insertAttachment(input: InsertAttachmentInput): Promise<ChatAttachment>;
  getAttachment(id: string): Promise<ChatAttachment | null>;
  listAttachments(messageIds: readonly string[]): Promise<ChatAttachment[]>;

  getLastReadSeq(workspaceId: string, userId: string): Promise<number>;
  setLastReadSeq(workspaceId: string, userId: string, seq: number): Promise<void>;
  countUnread(workspaceId: string, userId: string): Promise<number>;
  maxSeq(workspaceId: string): Promise<number>;

  // Пространства, где юзер — участник, с метаданными для списка чат-комнат (см. ChatService.listRooms).
  listChatRoomsForUser(userId: string): Promise<ChatRoomRow[]>;
}
