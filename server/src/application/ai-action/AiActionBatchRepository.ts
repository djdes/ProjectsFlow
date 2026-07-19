import type {
  AiActionBatch,
  AiActionBatchItemStatus,
  AiActionBatchStatus,
  AiActionBeforeSnapshot,
  AiActionEntityKind,
  AiActionType,
} from '../../domain/ai-action/AiActionBatch.js';

export type NewAiActionBatchItem = {
  readonly actionId: string;
  readonly type: AiActionType;
  readonly entityKind: AiActionEntityKind;
  readonly entityId: string | null;
  readonly projectId: string | null;
  readonly title: string;
};

export type CreateAiActionBatchRecord = {
  readonly id: string;
  readonly conversationId: string;
  readonly messageId: string | null;
  readonly ownerUserId: string;
  readonly projectId: string | null;
  readonly status: AiActionBatchStatus;
  readonly title: string;
  readonly idempotencyKey: string;
  readonly createdBy: string;
  readonly plan: Readonly<Record<string, unknown>> | null;
  readonly appliedAt: Date | null;
  readonly items: readonly NewAiActionBatchItem[];
};

/**
 * Result of an execution attempt reported by the executor (currently the client).
 * Matched to an item by `actionId` plus ordinal, because one action id can expand into
 * many items (delete_all_tasks).
 */
export type AiActionItemResult = {
  readonly actionId: string;
  readonly entityId: string | null;
  readonly projectId: string | null;
  readonly title?: string;
  readonly status: Extract<AiActionBatchItemStatus, 'done' | 'failed'>;
  readonly before?: AiActionBeforeSnapshot | null;
  readonly errorMessage?: string | null;
};

export interface AiActionBatchRepository {
  /**
   * Insert the batch and its items atomically. Returns `created: false` together with
   * the existing row when (conversationId, idempotencyKey) is already taken — this is
   * the single gate that stops the same plan being executed twice.
   */
  create(record: CreateAiActionBatchRecord): Promise<{ batch: AiActionBatch; created: boolean }>;
  findById(id: string): Promise<AiActionBatch | null>;
  findByIdempotencyKey(conversationId: string, key: string): Promise<AiActionBatch | null>;
  listForConversation(conversationId: string): Promise<AiActionBatch[]>;
  /**
   * Merge execution results into the batch items and optionally move the batch to a new
   * status. `expectedStatuses` is the optimistic guard: null is returned when the batch
   * is no longer in one of them, so the caller can decide between replay and conflict.
   * `nextStatus: null` records results without touching the batch status.
   */
  recordResults(input: {
    readonly batchId: string;
    readonly ownerUserId: string;
    readonly expectedStatuses: readonly AiActionBatchStatus[];
    readonly nextStatus: AiActionBatchStatus | null;
    readonly at: Date;
    readonly results: readonly AiActionItemResult[];
  }): Promise<AiActionBatch | null>;
  /**
   * Mark listed items as rolled back and move the batch to `undone`. Items that failed
   * to roll back keep their status and carry the reason.
   */
  finishUndo(input: {
    readonly batchId: string;
    readonly ownerUserId: string;
    readonly at: Date;
    readonly undoneItemIds: readonly string[];
    readonly failures: readonly { readonly itemId: string; readonly errorMessage: string }[];
  }): Promise<AiActionBatch | null>;
}
