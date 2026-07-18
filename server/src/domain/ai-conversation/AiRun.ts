import type { AiConversationMessage } from './AiMessage.js';

export type AiConversationRunMode = 'chat' | 'studio_plan' | 'studio_edit';
export type AiConversationRunStatus =
  | 'queued'
  | 'claimed'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AiConversationRun = {
  readonly id: string;
  readonly conversationId: string;
  readonly projectId: string | null;
  readonly dispatcherUserId: string;
  readonly userMessageId: string;
  readonly assistantMessageId: string;
  readonly mode: AiConversationRunMode;
  readonly status: AiConversationRunStatus;
  readonly contextVersion: number;
  readonly contextSnapshot: Readonly<Record<string, unknown>> | null;
  readonly idempotencyKey: string;
  readonly completionIdempotencyKey: string | null;
  readonly leaseTokenHash: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly claimedAt: Date | null;
  readonly projectEditJobId: string | null;
  readonly model: string | null;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly costUsd: number | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly updatedAt: Date;
};

export type PendingAiConversationRun = {
  readonly run: AiConversationRun;
  readonly conversationTitle: string;
  readonly projectName: string | null;
  readonly inputText: string;
  readonly history: readonly AiConversationMessage[];
};
