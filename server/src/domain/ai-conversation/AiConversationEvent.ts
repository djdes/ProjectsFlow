export type AiConversationEventType =
  | 'conversation.created'
  | 'conversation.updated'
  | 'conversation.archived'
  | 'conversation.restored'
  | 'message.created'
  | 'message.updated'
  | 'run.queued'
  | 'run.claimed'
  | 'run.running'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled';

export type AiConversationEvent = {
  readonly eventSeq: number;
  readonly conversationId: string;
  readonly eventType: AiConversationEventType;
  readonly entityId: string | null;
  readonly payload: Readonly<Record<string, unknown>> | null;
  readonly createdAt: Date;
};
