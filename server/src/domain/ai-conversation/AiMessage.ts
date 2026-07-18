export type AiMessageRole = 'user' | 'assistant' | 'system' | 'tool';
export type AiMessageStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type AiConversationMessage = {
  readonly id: string;
  readonly seq: number;
  readonly conversationId: string;
  readonly role: AiMessageRole;
  readonly status: AiMessageStatus;
  readonly body: string;
  readonly parentMessageId: string | null;
  readonly clientRequestId: string | null;
  readonly runId: string | null;
  readonly model: string | null;
  readonly metadata: Readonly<Record<string, unknown>> | null;
  readonly errorCode: string | null;
  readonly errorRetryable: boolean;
  readonly deletedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};
