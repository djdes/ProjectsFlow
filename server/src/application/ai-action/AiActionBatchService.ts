import type {
  AiActionBatch,
  AiActionBatchItem,
  AiActionType,
} from '../../domain/ai-action/AiActionBatch.js';
import { batchRequiresReview, canUndoBatch } from '../../domain/ai-action/AiActionBatch.js';
import type { AiActionArtifact } from '../../domain/ai-action/AiActionArtifact.js';
import { collectAiActionArtifacts } from '../../domain/ai-action/AiActionArtifact.js';
import {
  AiActionBatchNotFoundError,
  AiActionBatchStateConflictError,
  AiActionBatchValidationError,
} from '../../domain/ai-action/errors.js';
import type {
  AiActionBatchRepository,
  AiActionItemResult,
  NewAiActionBatchItem,
} from './AiActionBatchRepository.js';
import type { AiActionUndoExecutor } from './AiActionUndoExecutor.js';

const MAX_ITEMS = 200;

// Structural slice of AiConversationService: the batch feature only needs the ownership
// gate, and depending on the whole class would make the two services mutually reachable.
export type AiConversationAccessChecker = {
  assertCanAccess(userId: string, conversationId: string): Promise<unknown>;
};

export type AiActionBatchServiceDeps = {
  readonly repo: AiActionBatchRepository;
  readonly conversations: AiConversationAccessChecker;
  readonly undoExecutor: AiActionUndoExecutor;
  readonly idGen: () => string;
  readonly now?: () => Date;
};

export type CreateAiActionBatchInput = {
  readonly conversationId: string;
  readonly messageId: string | null;
  // Falls back to messageId. Explicit only for plans rendered before the message got an id.
  readonly idempotencyKey?: string;
  readonly title: string;
  readonly projectId?: string | null;
  readonly plan?: Readonly<Record<string, unknown>> | null;
  readonly items: readonly NewAiActionBatchItem[];
};

export type CreateAiActionBatchResult = {
  readonly batch: AiActionBatch;
  /**
   * true when the batch already existed. The caller MUST NOT execute the plan again:
   * this flag is what replaces the old localStorage guard and is the only thing standing
   * between a double render / F5 and duplicated projects.
   */
  readonly replayed: boolean;
};

export class AiActionBatchService {
  private readonly now: () => Date;

  constructor(private readonly deps: AiActionBatchServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async create(userId: string, input: CreateAiActionBatchInput): Promise<CreateAiActionBatchResult> {
    await this.deps.conversations.assertCanAccess(userId, input.conversationId);

    const idempotencyKey = (input.idempotencyKey ?? input.messageId ?? '').trim();
    if (!idempotencyKey) {
      throw new AiActionBatchValidationError('messageId or idempotencyKey is required');
    }
    if (input.items.length === 0 || input.items.length > MAX_ITEMS) {
      throw new AiActionBatchValidationError(`items must contain 1..${MAX_ITEMS} entries`);
    }

    const types = input.items.map((item) => item.type as AiActionType);
    const requiresReview = batchRequiresReview(types);
    const at = this.now();
    const { batch, created } = await this.deps.repo.create({
      id: this.deps.idGen(),
      conversationId: input.conversationId,
      messageId: input.messageId,
      ownerUserId: userId,
      projectId: input.projectId ?? null,
      // Non-destructive plans run unattended, so the journal records them as applied at
      // creation time; only a destructive plan waits for an explicit decision.
      status: requiresReview ? 'pending_review' : 'applied',
      title: input.title.trim().slice(0, 200) || 'Действия ассистента',
      idempotencyKey,
      createdBy: userId,
      plan: input.plan ?? null,
      appliedAt: requiresReview ? null : at,
      items: input.items,
    });
    return { batch, replayed: !created };
  }

  async get(userId: string, batchId: string): Promise<AiActionBatch> {
    const batch = await this.deps.repo.findById(batchId);
    if (!batch || batch.ownerUserId !== userId) throw new AiActionBatchNotFoundError();
    return batch;
  }

  async listForConversation(userId: string, conversationId: string): Promise<AiActionBatch[]> {
    await this.deps.conversations.assertCanAccess(userId, conversationId);
    return this.deps.repo.listForConversation(conversationId);
  }

  /**
   * Панель Artifacts. Считается по журналу батчей, а не по факту существования
   * сущностей: карточка «Создано» обязана остаться в диалоге даже после того, как
   * объект удалили.
   */
  async listArtifacts(userId: string, conversationId: string): Promise<AiActionArtifact[]> {
    return collectAiActionArtifacts(await this.listForConversation(userId, conversationId));
  }

  /**
   * Record what the executed actions actually touched (ids, before-snapshots) without
   * deciding anything. Called right after the non-destructive stage runs.
   */
  async recordResults(
    userId: string,
    batchId: string,
    results: readonly AiActionItemResult[],
  ): Promise<AiActionBatch> {
    const current = await this.get(userId, batchId);
    if (current.status === 'undone' || current.status === 'rejected') {
      throw new AiActionBatchStateConflictError(current.status);
    }
    const updated = await this.deps.repo.recordResults({
      batchId,
      ownerUserId: userId,
      expectedStatuses: ['pending_review', 'applied'],
      nextStatus: null,
      at: this.now(),
      results,
    });
    if (!updated) throw new AiActionBatchStateConflictError(current.status);
    return updated;
  }

  /**
   * Confirm the destructive stage. Idempotent by design: a double click or a retry after
   * a dropped response finds the batch already `applied` and returns it untouched instead
   * of deleting a second time.
   */
  async apply(
    userId: string,
    batchId: string,
    results: readonly AiActionItemResult[] = [],
  ): Promise<AiActionBatch> {
    const current = await this.get(userId, batchId);
    if (current.status === 'applied') {
      return results.length > 0 ? this.recordResults(userId, batchId, results) : current;
    }
    if (current.status !== 'pending_review') {
      throw new AiActionBatchStateConflictError(current.status);
    }
    const updated = await this.deps.repo.recordResults({
      batchId,
      ownerUserId: userId,
      expectedStatuses: ['pending_review'],
      nextStatus: 'applied',
      at: this.now(),
      results,
    });
    // Lost the race with a concurrent apply: re-read instead of failing, the outcome the
    // caller wanted has already happened.
    if (!updated) return this.get(userId, batchId);
    return updated;
  }

  async reject(userId: string, batchId: string): Promise<AiActionBatch> {
    const current = await this.get(userId, batchId);
    if (current.status === 'rejected') return current;
    if (current.status !== 'pending_review') {
      throw new AiActionBatchStateConflictError(current.status);
    }
    const updated = await this.deps.repo.recordResults({
      batchId,
      ownerUserId: userId,
      expectedStatuses: ['pending_review'],
      nextStatus: 'rejected',
      at: this.now(),
      results: [],
    });
    if (!updated) return this.get(userId, batchId);
    return updated;
  }

  /**
   * Roll the batch back from the journal. Works after a reload precisely because the
   * entity ids and before-snapshots live in the database, not in a React ref.
   */
  async undo(userId: string, batchId: string): Promise<AiActionBatch> {
    const current = await this.get(userId, batchId);
    if (current.status === 'undone') return current;
    if (!canUndoBatch(current.status)) throw new AiActionBatchStateConflictError(current.status);

    const undoneItemIds: string[] = [];
    const failures: { itemId: string; errorMessage: string }[] = [];

    // Reverse order: create_project is journalled before the tasks that live in it, so it
    // must be removed last. Independent items keep rolling back after one of them fails.
    const done = current.items.filter((item) => item.status === 'done');
    for (const item of [...done].sort((a, b) => b.position - a.position)) {
      try {
        await this.undoItem(userId, item);
        undoneItemIds.push(item.id);
      } catch (cause) {
        failures.push({
          itemId: item.id,
          errorMessage: (cause instanceof Error ? cause.message : String(cause)).slice(0, 500),
        });
      }
    }

    const updated = await this.deps.repo.finishUndo({
      batchId,
      ownerUserId: userId,
      at: this.now(),
      undoneItemIds,
      failures,
    });
    if (!updated) return this.get(userId, batchId);
    return updated;
  }

  private async undoItem(userId: string, item: AiActionBatchItem): Promise<void> {
    if (!item.entityId) return;
    if (item.type === 'create_project') {
      await this.deps.undoExecutor.deleteProject(item.entityId, userId);
      return;
    }
    if (!item.projectId) {
      throw new AiActionBatchValidationError('item has no project to roll back against');
    }
    if (item.type === 'create_task') {
      await this.deps.undoExecutor.deleteTask(item.projectId, userId, item.entityId);
      return;
    }
    if (item.type === 'update_task') {
      // No snapshot means nothing is known about the previous field values; silently
      // skipping is better than writing defaults over the user's data.
      if (!item.before) return;
      await this.deps.undoExecutor.updateTask(item.projectId, userId, item.entityId, item.before);
      return;
    }
    // delete_task / delete_all_tasks — soft delete (db/134), so the row comes back with
    // the SAME id and keeps its comments, versions and links.
    await this.deps.undoExecutor.restoreTask(item.projectId, userId, item.entityId);
  }
}
