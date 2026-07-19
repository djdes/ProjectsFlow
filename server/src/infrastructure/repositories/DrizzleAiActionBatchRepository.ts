import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type {
  AiActionBatchRepository,
  AiActionItemResult,
  CreateAiActionBatchRecord,
} from '../../application/ai-action/AiActionBatchRepository.js';
import type {
  AiActionBatch,
  AiActionBatchItem,
  AiActionBatchStatus,
  AiActionBeforeSnapshot,
  AiActionType,
} from '../../domain/ai-action/AiActionBatch.js';
import type { Database } from '../db/index.js';
import {
  aiActionBatchItems,
  aiActionBatches,
  type AiActionBatchItemRow,
  type AiActionBatchRow,
} from '../db/schema.js';
import { parseJsonCol } from './jsonCol.js';

// MySQL ER_DUP_ENTRY = 1062. The idempotency UNIQUE is expected to fire on replay, so it
// is a normal control-flow signal here, not an error.
function isDuplicateKey(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  const errno = (error as { errno?: number }).errno;
  return code === 'ER_DUP_ENTRY' || errno === 1062;
}

function toItem(row: AiActionBatchItemRow): AiActionBatchItem {
  return {
    id: row.id,
    batchId: row.batchId,
    position: row.position,
    actionId: row.actionId,
    type: row.type as AiActionType,
    entityKind: row.entityKind,
    entityId: row.entityId,
    projectId: row.projectId,
    title: row.title,
    status: row.status,
    before: parseJsonCol<AiActionBeforeSnapshot | null>(row.beforeJson, null),
    errorMessage: row.errorMessage,
  };
}

function toBatch(row: AiActionBatchRow, items: readonly AiActionBatchItem[]): AiActionBatch {
  return {
    id: row.id,
    conversationId: row.conversationId,
    messageId: row.messageId,
    ownerUserId: row.ownerUserId,
    projectId: row.projectId,
    status: row.status,
    title: row.title,
    idempotencyKey: row.idempotencyKey,
    createdBy: row.createdBy,
    appliedAt: row.appliedAt,
    undoneAt: row.undoneAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    items,
  };
}

export class DrizzleAiActionBatchRepository implements AiActionBatchRepository {
  constructor(private readonly db: Database) {}

  async create(
    record: CreateAiActionBatchRecord,
  ): Promise<{ batch: AiActionBatch; created: boolean }> {
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(aiActionBatches).values({
          id: record.id,
          conversationId: record.conversationId,
          messageId: record.messageId,
          ownerUserId: record.ownerUserId,
          projectId: record.projectId,
          status: record.status,
          title: record.title,
          planJson: record.plan as Record<string, unknown> | null,
          idempotencyKey: record.idempotencyKey,
          createdBy: record.createdBy,
          appliedAt: record.appliedAt,
        });
        await tx.insert(aiActionBatchItems).values(
          record.items.map((item, index) => ({
            id: randomUUID(),
            batchId: record.id,
            position: index,
            actionId: item.actionId,
            type: item.type,
            entityKind: item.entityKind,
            entityId: item.entityId,
            projectId: item.projectId,
            title: item.title.slice(0, 300),
          })),
        );
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const existing = await this.findByIdempotencyKey(
        record.conversationId,
        record.idempotencyKey,
      );
      if (!existing) throw error;
      return { batch: existing, created: false };
    }
    const batch = await this.findById(record.id);
    if (!batch) throw new Error('ai action batch vanished right after insert');
    return { batch, created: true };
  }

  async findById(id: string): Promise<AiActionBatch | null> {
    const [row] = await this.db.select().from(aiActionBatches).where(eq(aiActionBatches.id, id)).limit(1);
    if (!row) return null;
    return toBatch(row, await this.loadItems([row.id]));
  }

  async findByIdempotencyKey(conversationId: string, key: string): Promise<AiActionBatch | null> {
    const [row] = await this.db
      .select()
      .from(aiActionBatches)
      .where(
        and(
          eq(aiActionBatches.conversationId, conversationId),
          eq(aiActionBatches.idempotencyKey, key),
        ),
      )
      .limit(1);
    if (!row) return null;
    return toBatch(row, await this.loadItems([row.id]));
  }

  async listForConversation(conversationId: string): Promise<AiActionBatch[]> {
    const rows = await this.db
      .select()
      .from(aiActionBatches)
      .where(eq(aiActionBatches.conversationId, conversationId))
      .orderBy(asc(aiActionBatches.createdAt));
    if (rows.length === 0) return [];
    const items = await this.loadItems(rows.map((row) => row.id));
    return rows.map((row) => toBatch(row, items.filter((item) => item.batchId === row.id)));
  }

  async recordResults(input: {
    readonly batchId: string;
    readonly ownerUserId: string;
    readonly expectedStatuses: readonly AiActionBatchStatus[];
    readonly nextStatus: AiActionBatchStatus | null;
    readonly at: Date;
    readonly results: readonly AiActionItemResult[];
  }): Promise<AiActionBatch | null> {
    const ok = await this.db.transaction(async (tx) => {
      // FOR UPDATE: apply and undo race each other on a double click; without the lock two
      // transactions could both read `pending_review` and both transition.
      const [row] = await tx
        .select()
        .from(aiActionBatches)
        .where(
          and(
            eq(aiActionBatches.id, input.batchId),
            eq(aiActionBatches.ownerUserId, input.ownerUserId),
          ),
        )
        .limit(1)
        .for('update');
      if (!row || !input.expectedStatuses.includes(row.status)) return false;

      const itemRows = await tx
        .select()
        .from(aiActionBatchItems)
        .where(eq(aiActionBatchItems.batchId, input.batchId))
        .orderBy(asc(aiActionBatchItems.position));

      // One action id can own several items (delete_all_tasks); results are consumed in
      // order so the n-th result of an action lands on the n-th still-pending item.
      const pendingByAction = new Map<string, AiActionBatchItemRow[]>();
      for (const item of itemRows) {
        if (item.status !== 'pending') continue;
        const bucket = pendingByAction.get(item.actionId);
        if (bucket) bucket.push(item);
        else pendingByAction.set(item.actionId, [item]);
      }

      for (const result of input.results) {
        const target = pendingByAction.get(result.actionId)?.shift();
        if (!target) continue;
        await tx
          .update(aiActionBatchItems)
          .set({
            entityId: result.entityId,
            projectId: result.projectId,
            ...(result.title ? { title: result.title.slice(0, 300) } : {}),
            status: result.status,
            beforeJson: (result.before ?? null) as Record<string, unknown> | null,
            errorMessage: result.errorMessage?.slice(0, 500) ?? null,
          })
          .where(eq(aiActionBatchItems.id, target.id));
      }

      if (input.nextStatus) {
        await tx
          .update(aiActionBatches)
          .set({
            status: input.nextStatus,
            ...(input.nextStatus === 'applied' ? { appliedAt: input.at } : {}),
          })
          .where(eq(aiActionBatches.id, input.batchId));
      }
      return true;
    });
    return ok ? this.findById(input.batchId) : null;
  }

  async finishUndo(input: {
    readonly batchId: string;
    readonly ownerUserId: string;
    readonly at: Date;
    readonly undoneItemIds: readonly string[];
    readonly failures: readonly { readonly itemId: string; readonly errorMessage: string }[];
  }): Promise<AiActionBatch | null> {
    const ok = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(aiActionBatches)
        .where(
          and(
            eq(aiActionBatches.id, input.batchId),
            eq(aiActionBatches.ownerUserId, input.ownerUserId),
          ),
        )
        .limit(1)
        .for('update');
      if (!row || row.status !== 'applied') return false;

      if (input.undoneItemIds.length > 0) {
        await tx
          .update(aiActionBatchItems)
          .set({ status: 'undone', errorMessage: null })
          .where(inArray(aiActionBatchItems.id, [...input.undoneItemIds]));
      }
      for (const failure of input.failures) {
        await tx
          .update(aiActionBatchItems)
          .set({ errorMessage: failure.errorMessage.slice(0, 500) })
          .where(eq(aiActionBatchItems.id, failure.itemId));
      }
      await tx
        .update(aiActionBatches)
        .set({ status: 'undone', undoneAt: input.at })
        .where(eq(aiActionBatches.id, input.batchId));
      return true;
    });
    return ok ? this.findById(input.batchId) : null;
  }

  private async loadItems(batchIds: readonly string[]): Promise<AiActionBatchItem[]> {
    const rows = await this.db
      .select()
      .from(aiActionBatchItems)
      .where(inArray(aiActionBatchItems.batchId, [...batchIds]))
      .orderBy(asc(aiActionBatchItems.position));
    return rows.map(toItem);
  }
}
