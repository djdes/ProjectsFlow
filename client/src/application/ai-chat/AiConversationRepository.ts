import type {
  AiConversation,
  AiConversationKind,
  AiMessage,
  SendAiMessageResult,
} from '@/domain/ai-chat/AiConversation';
import type { AiKnowledgeSource } from '@/domain/ai-chat/AiKnowledgeSource';

export type AiConversationListQuery = {
  scope?: 'personal' | 'project' | 'all';
  projectId?: string;
  archived?: boolean;
  search?: string;
  before?: string;
  limit?: number;
};

export type AiConversationListResult = {
  items: AiConversation[];
  nextCursor: string | null;
};

export type AiMessageListResult = {
  items: AiMessage[];
  nextCursor: string | null;
};

export interface AiConversationRepository {
  list(query?: AiConversationListQuery): Promise<AiConversationListResult>;
  create(input: { kind: AiConversationKind; projectId?: string; title?: string }): Promise<AiConversation>;
  get(conversationId: string): Promise<AiConversation>;
  update(conversationId: string, input: { title?: string; archived?: boolean; expectedVersion?: number }): Promise<AiConversation>;
  remove(conversationId: string): Promise<void>;
  getOrCreateProjectStudio(projectId: string): Promise<AiConversation>;
  listMessages(conversationId: string, query?: { beforeSeq?: string; afterSeq?: string; limit?: number }): Promise<AiMessageListResult>;
  sendMessage(conversationId: string, input: { body: string; clientRequestId: string; mode?: 'chat' | 'studio_plan'; expectedConversationVersion?: number }): Promise<SendAiMessageResult>;
  cancelRun(conversationId: string, runId: string): Promise<void>;
  // Панель Knowledge: накопительный за диалог список просмотренных агентом источников.
  listKnowledge(conversationId: string): Promise<AiKnowledgeSource[]>;
  streamUrl(conversationId: string, afterEventId?: string | null): string;
}

export const aiConversationKeys = {
  all: ['ai-conversations'] as const,
  lists: () => ['ai-conversations', 'list'] as const,
  list: (query: AiConversationListQuery = {}) => ['ai-conversations', 'list', query] as const,
  detail: (conversationId: string) => ['ai-conversations', 'detail', conversationId] as const,
  messages: (conversationId: string) => ['ai-conversations', 'messages', conversationId] as const,
  knowledge: (conversationId: string) => ['ai-conversations', 'knowledge', conversationId] as const,
  run: (conversationId: string, runId: string) => ['ai-conversations', 'run', conversationId, runId] as const,
  projectStudio: (projectId: string) => ['ai-conversations', 'project-studio', projectId] as const,
};
