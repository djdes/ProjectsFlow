import type {
  AiConversationListQuery,
  AiConversationListResult,
  AiConversationRepository,
  AiMessageListResult,
} from '@/application/ai-chat/AiConversationRepository';
import type {
  AiConversation,
  AiConversationKind,
  SendAiMessageResult,
} from '@/domain/ai-chat/AiConversation';
import { httpClient } from './httpClient';

function queryString(values: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const value = params.toString();
  return value ? `?${value}` : '';
}

function unwrapItems<T>(value: { items?: T[]; conversations?: T[]; messages?: T[]; nextCursor?: string | null } | T[]): { items: T[]; nextCursor: string | null } {
  if (Array.isArray(value)) return { items: value, nextCursor: null };
  return {
    items: value.items ?? value.conversations ?? value.messages ?? [],
    nextCursor: value.nextCursor ?? null,
  };
}

export class HttpAiConversationRepository implements AiConversationRepository {
  async list(query: AiConversationListQuery = {}): Promise<AiConversationListResult> {
    const value = await httpClient.get<AiConversationListResult | { conversations: AiConversation[]; nextCursor?: string | null } | AiConversation[]>(
      `/ai/conversations${queryString(query)}`,
    );
    return unwrapItems(value);
  }

  async create(input: { kind: AiConversationKind; projectId?: string; title?: string }): Promise<AiConversation> {
    const value = await httpClient.post<AiConversation | { conversation: AiConversation }>('/ai/conversations', input);
    return 'conversation' in value ? value.conversation : value;
  }

  async get(conversationId: string): Promise<AiConversation> {
    const value = await httpClient.get<AiConversation | { conversation: AiConversation }>(`/ai/conversations/${encodeURIComponent(conversationId)}`);
    return 'conversation' in value ? value.conversation : value;
  }

  async update(conversationId: string, input: { title?: string; archived?: boolean; expectedVersion?: number }): Promise<AiConversation> {
    const path = `/ai/conversations/${encodeURIComponent(conversationId)}`;
    const value = input.archived === true
      ? await httpClient.delete<AiConversation | { conversation: AiConversation }>(path)
      : input.archived === false
        ? await httpClient.post<AiConversation | { conversation: AiConversation }>(`${path}/restore`, { expectedVersion: input.expectedVersion })
        : await httpClient.patch<AiConversation | { conversation: AiConversation }>(path, { title: input.title, expectedVersion: input.expectedVersion });
    return 'conversation' in value ? value.conversation : value;
  }

  remove(conversationId: string): Promise<void> {
    return httpClient.delete(`/ai/conversations/${encodeURIComponent(conversationId)}`);
  }

  async getOrCreateProjectStudio(projectId: string): Promise<AiConversation> {
    const path = `/projects/${encodeURIComponent(projectId)}/studio/conversations`;
    const value = await httpClient.post<AiConversation | { conversation: AiConversation }>(path);
    return 'conversation' in value ? value.conversation : value;
  }

  async listMessages(conversationId: string, query: { beforeSeq?: string; afterSeq?: string; limit?: number } = {}): Promise<AiMessageListResult> {
    const value = await httpClient.get<AiMessageListResult | { messages: AiMessageListResult['items']; nextCursor?: string | null } | AiMessageListResult['items']>(
      `/ai/conversations/${encodeURIComponent(conversationId)}/messages${queryString(query)}`,
    );
    return unwrapItems(value);
  }

  sendMessage(conversationId: string, input: { body: string; clientRequestId: string; mode?: 'chat' | 'studio_plan'; expectedConversationVersion?: number }): Promise<SendAiMessageResult> {
    return httpClient.post(`/ai/conversations/${encodeURIComponent(conversationId)}/messages`, input);
  }

  cancelRun(conversationId: string, runId: string): Promise<void> {
    return httpClient.post(`/ai/conversations/${encodeURIComponent(conversationId)}/runs/${encodeURIComponent(runId)}/cancel`);
  }

  streamUrl(conversationId: string, afterEventId?: string | null): string {
    const suffix = afterEventId ? queryString({ after: afterEventId }) : '';
    return `/api/ai/conversations/${encodeURIComponent(conversationId)}/stream${suffix}`;
  }
}
