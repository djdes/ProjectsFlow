import type { TaskPriority, TaskStatus } from '../task/Task.js';

export type AiActionType =
  | 'create_project'
  | 'create_task'
  | 'update_task'
  | 'delete_task'
  | 'delete_all_tasks';

export type AiActionEntityKind = 'project' | 'task';

/**
 * Lifecycle of a batch. `pending_review` is only reachable for plans that contain at
 * least one destructive action: everything else is journalled as already `applied`,
 * because non-destructive actions run without asking (reference §1).
 */
export type AiActionBatchStatus = 'pending_review' | 'applied' | 'rejected' | 'undone';

export type AiActionBatchItemStatus = 'pending' | 'done' | 'failed' | 'undone';

/**
 * Fields captured before a mutating action ran. Only what the plan is allowed to change
 * is stored — a full task snapshot would rot against future columns and is not needed:
 * undo restores the same row, not a copy of it.
 */
export type AiActionBeforeSnapshot = {
  readonly description?: string | null;
  readonly status?: TaskStatus;
  readonly deadline?: string | null;
  readonly priority?: TaskPriority | null;
};

export type AiActionBatchItem = {
  readonly id: string;
  readonly batchId: string;
  readonly position: number;
  readonly actionId: string;
  readonly type: AiActionType;
  readonly entityKind: AiActionEntityKind;
  readonly entityId: string | null;
  readonly projectId: string | null;
  readonly title: string;
  readonly status: AiActionBatchItemStatus;
  readonly before: AiActionBeforeSnapshot | null;
  readonly errorMessage: string | null;
};

export type AiActionBatch = {
  readonly id: string;
  readonly conversationId: string;
  readonly messageId: string | null;
  readonly ownerUserId: string;
  readonly projectId: string | null;
  readonly status: AiActionBatchStatus;
  readonly title: string;
  readonly idempotencyKey: string;
  readonly createdBy: string;
  readonly appliedAt: Date | null;
  readonly undoneAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly items: readonly AiActionBatchItem[];
};

// Destructive = irreversibly removes user data for a concrete object without the user
// having asked for that object by name. Creation and field edits are rolled back by the
// batch journal, so they need no review.
const DESTRUCTIVE_ACTION_TYPES: ReadonlySet<AiActionType> = new Set<AiActionType>([
  'delete_task',
  'delete_all_tasks',
]);

export function isDestructiveActionType(type: AiActionType): boolean {
  return DESTRUCTIVE_ACTION_TYPES.has(type);
}

export function batchRequiresReview(types: readonly AiActionType[]): boolean {
  return types.some(isDestructiveActionType);
}

// Terminal states cannot be re-decided; only `applied` can still be undone.
export function canUndoBatch(status: AiActionBatchStatus): boolean {
  return status === 'applied';
}
