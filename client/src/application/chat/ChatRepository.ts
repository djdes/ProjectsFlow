import type { ChatMessage } from '@/domain/chat/ChatMessage';
import type { ChatRoom } from '@/domain/chat/ChatRoom';

export type ListChatMessagesQuery = {
  readonly beforeSeq?: number;
  readonly afterSeq?: number;
  readonly limit?: number;
};

export type SendChatMessageInput = {
  readonly body: string;
  readonly replyToId?: string | null;
  readonly files?: readonly File[];
};

// Порт чата пространства. SSE-стрим (live-лента) НЕ здесь — его открывает хук напрямую
// через EventSource (как useLiveSession/useNotificationStream); порт покрывает REST.
export interface ChatRepository {
  // Чат-комнаты текущего юзера (для вкладки «Чат»: какой workspace-чат показывать/выбирать).
  listRooms(): Promise<ChatRoom[]>;
  listMessages(workspaceId: string, query?: ListChatMessagesQuery): Promise<ChatMessage[]>;
  sendMessage(workspaceId: string, input: SendChatMessageInput): Promise<ChatMessage>;
  editMessage(workspaceId: string, messageId: string, body: string): Promise<ChatMessage>;
  deleteMessage(workspaceId: string, messageId: string): Promise<void>;
  addReaction(workspaceId: string, messageId: string, emoji: string): Promise<void>;
  removeReaction(workspaceId: string, messageId: string, emoji: string): Promise<void>;
  markRead(workspaceId: string, lastReadSeq: number): Promise<void>;
  getUnreadCount(workspaceId: string): Promise<number>;
  // URL SSE-стрима для EventSource (afterSeq — с какого seq доигрывать).
  streamUrl(workspaceId: string, afterSeq: number): string;
  // URL бинаря вложения (для построения ChatAttachment.url).
  attachmentUrl(workspaceId: string, attachmentId: string): string;
}
