import type {
  AiConversation,
  AiConversationKind,
} from '../../domain/ai-conversation/AiConversation.js';
import type { AiConversationEvent } from '../../domain/ai-conversation/AiConversationEvent.js';
import type { AiConversationMessage } from '../../domain/ai-conversation/AiMessage.js';
import type {
  AiConversationRun,
  AiConversationRunMode,
  PendingAiConversationRun,
} from '../../domain/ai-conversation/AiRun.js';

export type AiMutationResult<T> = {
  readonly value: T;
  readonly events: readonly AiConversationEvent[];
};

export type ListAiConversationsQuery = {
  readonly kind?: AiConversationKind;
  readonly projectId?: string;
  readonly search?: string;
  readonly archived?: boolean;
  readonly before?: Date;
  readonly limit: number;
};

export type ListAiMessagesQuery = {
  readonly beforeSeq?: number;
  readonly afterSeq?: number;
  readonly limit: number;
};

export type CreateAiConversationRecord = {
  readonly id: string;
  readonly ownerUserId: string;
  readonly workspaceId: string | null;
  readonly projectId: string | null;
  readonly kind: AiConversationKind;
  readonly title: string;
};

export type CreateAiMessageRunRecord = {
  readonly conversationId: string;
  readonly ownerUserId: string;
  readonly userMessageId: string;
  readonly assistantMessageId: string;
  readonly runId: string;
  readonly body: string;
  readonly clientRequestId: string;
  readonly dispatcherUserId: string;
  readonly projectId: string | null;
  readonly mode: AiConversationRunMode;
  readonly contextVersion: number;
  readonly contextSnapshot: Readonly<Record<string, unknown>> | null;
  readonly expectedConversationVersion?: number;
  readonly requestId?: string | null;
};

export type AiMessageRunResult = {
  readonly conversation: AiConversation;
  readonly userMessage: AiConversationMessage;
  readonly assistantMessage: AiConversationMessage;
  readonly run: AiConversationRun;
  readonly replayed: boolean;
};

export type ClaimAiConversationRunInput = {
  readonly runId: string;
  readonly dispatcherUserId: string;
  readonly leaseTokenHash: string;
  readonly leaseExpiresAt: Date;
};

export type CompleteAiConversationRunInput = {
  readonly runId: string;
  readonly dispatcherUserId: string;
  readonly leaseTokenHash: string;
  readonly completionIdempotencyKey: string;
  readonly body: string;
  readonly model: string | null;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly costUsd: number | null;
  readonly requestId?: string | null;
};

export type FailAiConversationRunInput = {
  readonly runId: string;
  readonly dispatcherUserId: string;
  readonly leaseTokenHash: string;
  readonly completionIdempotencyKey: string;
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly retryable: boolean;
  readonly requestId?: string | null;
};

export type AiRunMutationValue = {
  readonly run: AiConversationRun;
  readonly assistantMessage: AiConversationMessage;
};

export interface AiConversationRepository {
  listForOwner(ownerUserId: string, query: ListAiConversationsQuery): Promise<AiConversation[]>;
  findById(id: string): Promise<AiConversation | null>;
  findProjectStudioForOwner(ownerUserId: string, projectId: string): Promise<AiConversation | null>;
  create(input: CreateAiConversationRecord): Promise<AiMutationResult<AiConversation>>;
  rename(
    id: string,
    ownerUserId: string,
    title: string,
    expectedVersion?: number,
  ): Promise<AiMutationResult<AiConversation> | null>;
  setArchived(
    id: string,
    ownerUserId: string,
    archived: boolean,
    expectedVersion?: number,
  ): Promise<AiMutationResult<AiConversation> | null>;

  listMessages(conversationId: string, query: ListAiMessagesQuery): Promise<AiConversationMessage[]>;
  createMessageRun(
    input: CreateAiMessageRunRecord,
  ): Promise<AiMutationResult<AiMessageRunResult> | null>;
  cancelRun(
    conversationId: string,
    ownerUserId: string,
    runId: string,
    requestId?: string | null,
  ): Promise<AiMutationResult<AiRunMutationValue> | null>;

  listEvents(conversationId: string, afterEventSeq: number, limit: number): Promise<AiConversationEvent[]>;

  listPendingForDispatcher(dispatcherUserId: string, limit: number): Promise<PendingAiConversationRun[]>;
  claimRun(input: ClaimAiConversationRunInput): Promise<AiMutationResult<AiConversationRun> | null>;
  completeRun(input: CompleteAiConversationRunInput): Promise<AiMutationResult<AiRunMutationValue> | null>;
  failRun(input: FailAiConversationRunInput): Promise<AiMutationResult<AiRunMutationValue> | null>;
}
