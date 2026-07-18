export type AiConversationKind = 'personal' | 'project_studio';

export type AiConversation = {
  id: string;
  kind: AiConversationKind;
  projectId: string | null;
  title: string;
  version: number;
  lastMessageSeq: string | null;
  lastMessageAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AiMessageRole = 'user' | 'assistant' | 'system' | 'tool';
export type AiMessageStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type AiMessage = {
  id: string;
  conversationId: string;
  seq: string;
  role: AiMessageRole;
  body: string;
  status: AiMessageStatus;
  runId: string | null;
  parentMessageId: string | null;
  clientRequestId?: string | null;
  error?: { code: string; retryable: boolean } | null;
  createdAt: string;
  updatedAt: string;
};

export type AiRun = {
  id: string;
  status: AiMessageStatus;
};

export type SendAiMessageResult = {
  conversation: AiConversation;
  userMessage: AiMessage;
  assistantMessage: AiMessage;
  run: AiRun;
};
