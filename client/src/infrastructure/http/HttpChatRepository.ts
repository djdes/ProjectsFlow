import type {
  ChatRepository,
  ListChatMessagesQuery,
  SendChatMessageInput,
} from '@/application/chat/ChatRepository';
import type {
  ChatMessage,
  ChatAttachment,
  ChatReactionAggregate,
  ChatReplyPreview,
} from '@/domain/chat/ChatMessage';
import type { ChatRoom } from '@/domain/chat/ChatRoom';
import { httpClient } from './httpClient';
import { HttpError, type HttpErrorBody } from '@/lib/HttpError';

// Wire-DTO (даты — ISO-строки; у вложений нет url — добавляем на клиенте).
type AttachmentDto = Omit<ChatAttachment, 'url'>;
type MessageDto = Omit<ChatMessage, 'createdAt' | 'editedAt' | 'attachments'> & {
  createdAt: string;
  editedAt: string | null;
  attachments: AttachmentDto[];
};

export class HttpChatRepository implements ChatRepository {
  private fromDto(workspaceId: string, dto: MessageDto): ChatMessage {
    return {
      id: dto.id,
      seq: dto.seq,
      workspaceId: dto.workspaceId,
      authorUserId: dto.authorUserId,
      authorDisplayName: dto.authorDisplayName,
      authorAvatarUrl: dto.authorAvatarUrl,
      body: dto.body,
      createdAt: new Date(dto.createdAt),
      editedAt: dto.editedAt ? new Date(dto.editedAt) : null,
      deleted: dto.deleted,
      replyTo: dto.replyTo as ChatReplyPreview | null,
      reactions: dto.reactions as ChatReactionAggregate[],
      attachments: dto.attachments.map((a) => ({
        ...a,
        url: this.attachmentUrl(workspaceId, a.id),
      })),
    };
  }

  async listRooms(): Promise<ChatRoom[]> {
    const { rooms } = await httpClient.get<{ rooms: ChatRoom[] }>('/workspaces/chat/rooms');
    return rooms;
  }

  async listMessages(workspaceId: string, query: ListChatMessagesQuery = {}): Promise<ChatMessage[]> {
    const qs = new URLSearchParams();
    if (query.beforeSeq !== undefined) qs.set('beforeSeq', String(query.beforeSeq));
    if (query.afterSeq !== undefined) qs.set('afterSeq', String(query.afterSeq));
    if (query.limit !== undefined) qs.set('limit', String(query.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const { messages } = await httpClient.get<{ messages: MessageDto[] }>(
      `/workspaces/${workspaceId}/chat/messages${suffix}`,
    );
    return messages.map((m) => this.fromDto(workspaceId, m));
  }

  // Multipart (тело + файлы) — fetch напрямую, httpClient умеет только JSON.
  async sendMessage(workspaceId: string, input: SendChatMessageInput): Promise<ChatMessage> {
    const form = new FormData();
    form.set('body', input.body);
    if (input.replyToId) form.set('replyToId', input.replyToId);
    for (const f of input.files ?? []) form.append('files', f);

    const res = await fetch(`/api/workspaces/${workspaceId}/chat/messages`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      body: form,
    });
    const text = await res.text();
    const data = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      throw new HttpError(res.status, (data as HttpErrorBody | null) ?? { error: 'unknown_error' });
    }
    return this.fromDto(workspaceId, (data as { message: MessageDto }).message);
  }

  async editMessage(workspaceId: string, messageId: string, body: string): Promise<ChatMessage> {
    const { message } = await httpClient.patch<{ message: MessageDto }>(
      `/workspaces/${workspaceId}/chat/messages/${messageId}`,
      { body },
    );
    return this.fromDto(workspaceId, message);
  }

  async deleteMessage(workspaceId: string, messageId: string): Promise<void> {
    await httpClient.delete(`/workspaces/${workspaceId}/chat/messages/${messageId}`);
  }

  async addReaction(workspaceId: string, messageId: string, emoji: string): Promise<void> {
    await httpClient.post(`/workspaces/${workspaceId}/chat/messages/${messageId}/reactions`, { emoji });
  }

  async removeReaction(workspaceId: string, messageId: string, emoji: string): Promise<void> {
    await httpClient.delete(
      `/workspaces/${workspaceId}/chat/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`,
    );
  }

  async markRead(workspaceId: string, lastReadSeq: number): Promise<void> {
    await httpClient.post(`/workspaces/${workspaceId}/chat/read`, { lastReadSeq });
  }

  async getUnreadCount(workspaceId: string): Promise<number> {
    const { count } = await httpClient.get<{ count: number }>(
      `/workspaces/${workspaceId}/chat/unread`,
    );
    return count;
  }

  streamUrl(workspaceId: string, afterSeq: number): string {
    return `/api/workspaces/${workspaceId}/chat/stream?afterSeq=${afterSeq}`;
  }

  attachmentUrl(workspaceId: string, attachmentId: string): string {
    return `/api/workspaces/${workspaceId}/chat/attachments/${attachmentId}`;
  }
}
