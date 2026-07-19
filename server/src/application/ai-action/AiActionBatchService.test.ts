import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AiActionBatch, AiActionBatchItem } from '../../domain/ai-action/AiActionBatch.js';
import {
  AiActionBatchNotFoundError,
  AiActionBatchStateConflictError,
} from '../../domain/ai-action/errors.js';
import type {
  AiActionBatchRepository,
  AiActionItemResult,
  CreateAiActionBatchRecord,
} from './AiActionBatchRepository.js';
import { AiActionBatchService } from './AiActionBatchService.js';
import type { AiActionUndoExecutor } from './AiActionUndoExecutor.js';

const NOW = new Date('2026-07-19T10:00:00.000Z');
const USER = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const CONVERSATION = '00000000-0000-4000-8000-000000000003';
const MESSAGE = '00000000-0000-4000-8000-000000000004';
const PROJECT = '00000000-0000-4000-8000-000000000005';
const TASK = '00000000-0000-4000-8000-000000000006';

class FakeRepo implements AiActionBatchRepository {
  readonly batches = new Map<string, AiActionBatch>();
  createCalls = 0;

  async create(record: CreateAiActionBatchRecord): Promise<{ batch: AiActionBatch; created: boolean }> {
    this.createCalls += 1;
    const existing = await this.findByIdempotencyKey(record.conversationId, record.idempotencyKey);
    if (existing) return { batch: existing, created: false };
    const batch: AiActionBatch = {
      id: record.id,
      conversationId: record.conversationId,
      messageId: record.messageId,
      ownerUserId: record.ownerUserId,
      projectId: record.projectId,
      status: record.status,
      title: record.title,
      idempotencyKey: record.idempotencyKey,
      createdBy: record.createdBy,
      appliedAt: record.appliedAt,
      undoneAt: null,
      createdAt: NOW,
      updatedAt: NOW,
      items: record.items.map((item, index) => ({
        id: `${record.id}:${index}`,
        batchId: record.id,
        position: index,
        actionId: item.actionId,
        type: item.type,
        entityKind: item.entityKind,
        entityId: item.entityId,
        projectId: item.projectId,
        title: item.title,
        status: 'pending' as const,
        before: null,
        errorMessage: null,
      })),
    };
    this.batches.set(batch.id, batch);
    return { batch, created: true };
  }

  async findById(id: string) { return this.batches.get(id) ?? null; }

  async findByIdempotencyKey(conversationId: string, key: string) {
    return [...this.batches.values()].find(
      (batch) => batch.conversationId === conversationId && batch.idempotencyKey === key,
    ) ?? null;
  }

  async listForConversation(conversationId: string) {
    return [...this.batches.values()].filter((batch) => batch.conversationId === conversationId);
  }

  async recordResults(input: {
    batchId: string;
    ownerUserId: string;
    expectedStatuses: readonly AiActionBatch['status'][];
    nextStatus: AiActionBatch['status'] | null;
    at: Date;
    results: readonly AiActionItemResult[];
  }) {
    const current = this.batches.get(input.batchId);
    if (!current || current.ownerUserId !== input.ownerUserId) return null;
    if (!input.expectedStatuses.includes(current.status)) return null;
    const pending = new Map<string, AiActionBatchItem[]>();
    for (const item of current.items) {
      if (item.status !== 'pending') continue;
      const bucket = pending.get(item.actionId);
      if (bucket) bucket.push(item); else pending.set(item.actionId, [item]);
    }
    const patched = new Map<string, AiActionBatchItem>();
    for (const result of input.results) {
      const target = pending.get(result.actionId)?.shift();
      if (!target) continue;
      patched.set(target.id, {
        ...target,
        entityId: result.entityId,
        projectId: result.projectId,
        ...(result.title ? { title: result.title } : {}),
        status: result.status,
        before: result.before ?? null,
        errorMessage: result.errorMessage ?? null,
      });
    }
    const next: AiActionBatch = {
      ...current,
      status: input.nextStatus ?? current.status,
      appliedAt: input.nextStatus === 'applied' ? input.at : current.appliedAt,
      items: current.items.map((item) => patched.get(item.id) ?? item),
    };
    this.batches.set(next.id, next);
    return next;
  }

  async finishUndo(input: {
    batchId: string;
    ownerUserId: string;
    at: Date;
    undoneItemIds: readonly string[];
    failures: readonly { itemId: string; errorMessage: string }[];
  }) {
    const current = this.batches.get(input.batchId);
    if (!current || current.ownerUserId !== input.ownerUserId) return null;
    if (current.status !== 'applied') return null;
    const undone = new Set(input.undoneItemIds);
    const failed = new Map(input.failures.map((f) => [f.itemId, f.errorMessage]));
    const next: AiActionBatch = {
      ...current,
      status: 'undone',
      undoneAt: input.at,
      items: current.items.map((item) => (
        undone.has(item.id)
          ? { ...item, status: 'undone' as const, errorMessage: null }
          : failed.has(item.id)
            ? { ...item, errorMessage: failed.get(item.id)! }
            : item
      )),
    };
    this.batches.set(next.id, next);
    return next;
  }
}

class FakeExecutor implements AiActionUndoExecutor {
  readonly calls: string[] = [];
  failOn: string | null = null;

  async deleteTask(projectId: string, _actor: string, taskId: string) {
    this.record(`deleteTask:${projectId}:${taskId}`);
  }
  async restoreTask(projectId: string, _actor: string, taskId: string) {
    this.record(`restoreTask:${projectId}:${taskId}`);
  }
  async updateTask(projectId: string, _actor: string, taskId: string, before: unknown) {
    this.record(`updateTask:${projectId}:${taskId}:${JSON.stringify(before)}`);
  }
  async deleteProject(projectId: string) {
    this.record(`deleteProject:${projectId}`);
  }
  private record(call: string): void {
    if (this.failOn && call.startsWith(this.failOn)) throw new Error('boom');
    this.calls.push(call);
  }
}

function build(): {
  service: AiActionBatchService;
  repo: FakeRepo;
  executor: FakeExecutor;
  access: { calls: string[] };
} {
  const repo = new FakeRepo();
  const executor = new FakeExecutor();
  const access = { calls: [] as string[] };
  let seq = 0;
  const service = new AiActionBatchService({
    repo,
    undoExecutor: executor,
    conversations: {
      async assertCanAccess(userId: string, conversationId: string) {
        access.calls.push(`${userId}:${conversationId}`);
        if (userId !== USER) throw new AiActionBatchNotFoundError();
        return null;
      },
    },
    idGen: () => `batch-${(seq += 1)}`,
    now: () => NOW,
  });
  return { service, repo, executor, access };
}

const safePlan = {
  conversationId: CONVERSATION,
  messageId: MESSAGE,
  title: 'Новый проект',
  projectId: null,
  items: [
    { actionId: 'a1', type: 'create_project' as const, entityKind: 'project' as const, entityId: null, projectId: null, title: 'Проект «Docs»' },
    { actionId: 'a2', type: 'create_task' as const, entityKind: 'task' as const, entityId: null, projectId: null, title: 'Настроить главную' },
  ],
};

const destructivePlan = {
  conversationId: CONVERSATION,
  messageId: MESSAGE,
  title: 'Очистка',
  projectId: PROJECT,
  items: [
    { actionId: 'd1', type: 'delete_all_tasks' as const, entityKind: 'task' as const, entityId: TASK, projectId: PROJECT, title: 'Старая задача' },
  ],
};

test('a plan without destructive actions is journalled as already applied', async () => {
  const { service } = build();
  const result = await service.create(USER, safePlan);
  assert.equal(result.replayed, false);
  assert.equal(result.batch.status, 'applied');
  assert.deepEqual(result.batch.appliedAt, NOW);
});

test('a plan containing a deletion waits for an explicit decision', async () => {
  const { service } = build();
  const result = await service.create(USER, destructivePlan);
  assert.equal(result.batch.status, 'pending_review');
  assert.equal(result.batch.appliedAt, null);
});

test('resending the same message id replays the batch instead of creating a second one', async () => {
  const { service, repo } = build();
  const first = await service.create(USER, safePlan);
  const second = await service.create(USER, safePlan);

  assert.equal(second.replayed, true);
  assert.equal(second.batch.id, first.batch.id);
  assert.equal(repo.batches.size, 1);
});

test('a different message id in the same conversation is a different batch', async () => {
  const { service, repo } = build();
  await service.create(USER, safePlan);
  await service.create(USER, { ...safePlan, messageId: PROJECT });
  assert.equal(repo.batches.size, 2);
});

test('creating a batch requires access to the conversation', async () => {
  const { service } = build();
  await assert.rejects(() => service.create(OTHER, safePlan), AiActionBatchNotFoundError);
});

test('another user cannot read or undo somebody elses batch', async () => {
  const { service } = build();
  const { batch } = await service.create(USER, safePlan);
  await assert.rejects(() => service.get(OTHER, batch.id), AiActionBatchNotFoundError);
  await assert.rejects(() => service.undo(OTHER, batch.id), AiActionBatchNotFoundError);
});

test('undo reverses done items in reverse order and rolls back to the same task id', async () => {
  const { service, executor } = build();
  const { batch } = await service.create(USER, safePlan);
  await service.recordResults(USER, batch.id, [
    { actionId: 'a1', entityId: PROJECT, projectId: null, status: 'done' },
    { actionId: 'a2', entityId: TASK, projectId: PROJECT, status: 'done' },
  ]);

  const undone = await service.undo(USER, batch.id);

  assert.equal(undone.status, 'undone');
  assert.deepEqual(executor.calls, [`deleteTask:${PROJECT}:${TASK}`, `deleteProject:${PROJECT}`]);
  assert.ok(undone.items.every((item) => item.status === 'undone'));
});

test('undo of a deletion restores the task rather than recreating it', async () => {
  const { service, executor } = build();
  const { batch } = await service.create(USER, destructivePlan);
  await service.apply(USER, batch.id, [
    { actionId: 'd1', entityId: TASK, projectId: PROJECT, status: 'done' },
  ]);

  await service.undo(USER, batch.id);

  assert.deepEqual(executor.calls, [`restoreTask:${PROJECT}:${TASK}`]);
});

test('undo of update_task replays the before snapshot', async () => {
  const { service, executor } = build();
  const { batch } = await service.create(USER, {
    ...safePlan,
    items: [{ actionId: 'u1', type: 'update_task' as const, entityKind: 'task' as const, entityId: TASK, projectId: PROJECT, title: 'Задача' }],
  });
  await service.recordResults(USER, batch.id, [
    { actionId: 'u1', entityId: TASK, projectId: PROJECT, status: 'done', before: { description: 'старое', priority: 3 } },
  ]);

  await service.undo(USER, batch.id);

  assert.deepEqual(
    executor.calls,
    [`updateTask:${PROJECT}:${TASK}:${JSON.stringify({ description: 'старое', priority: 3 })}`],
  );
});

test('undo skips update_task without a snapshot instead of writing defaults over user data', async () => {
  const { service, executor } = build();
  const { batch } = await service.create(USER, {
    ...safePlan,
    items: [{ actionId: 'u1', type: 'update_task' as const, entityKind: 'task' as const, entityId: TASK, projectId: PROJECT, title: 'Задача' }],
  });
  await service.recordResults(USER, batch.id, [
    { actionId: 'u1', entityId: TASK, projectId: PROJECT, status: 'done' },
  ]);

  await service.undo(USER, batch.id);

  assert.deepEqual(executor.calls, []);
});

test('a failing item does not stop the rest of the rollback', async () => {
  const { service, executor } = build();
  const { batch } = await service.create(USER, safePlan);
  await service.recordResults(USER, batch.id, [
    { actionId: 'a1', entityId: PROJECT, projectId: null, status: 'done' },
    { actionId: 'a2', entityId: TASK, projectId: PROJECT, status: 'done' },
  ]);
  executor.failOn = 'deleteTask';

  const undone = await service.undo(USER, batch.id);

  assert.deepEqual(executor.calls, [`deleteProject:${PROJECT}`]);
  assert.equal(undone.status, 'undone');
  assert.equal(undone.items.find((item) => item.actionId === 'a2')?.errorMessage, 'boom');
});

test('undoing twice is a no-op rather than a second rollback', async () => {
  const { service, executor } = build();
  const { batch } = await service.create(USER, safePlan);
  await service.recordResults(USER, batch.id, [
    { actionId: 'a1', entityId: PROJECT, projectId: null, status: 'done' },
  ]);

  await service.undo(USER, batch.id);
  const callsAfterFirst = [...executor.calls];
  const second = await service.undo(USER, batch.id);

  assert.equal(second.status, 'undone');
  assert.deepEqual(executor.calls, callsAfterFirst);
});

test('applying the same destructive batch twice does not delete twice', async () => {
  const { service } = build();
  const { batch } = await service.create(USER, destructivePlan);

  const first = await service.apply(USER, batch.id, [
    { actionId: 'd1', entityId: TASK, projectId: PROJECT, status: 'done' },
  ]);
  const second = await service.apply(USER, batch.id, [
    { actionId: 'd1', entityId: TASK, projectId: PROJECT, status: 'done' },
  ]);

  assert.equal(first.status, 'applied');
  assert.equal(second.status, 'applied');
  // The single item stayed single: the replayed apply found nothing pending to consume.
  assert.equal(second.items.length, 1);
  assert.equal(second.items.filter((item) => item.status === 'done').length, 1);
});

test('rejecting is idempotent and blocks a later apply', async () => {
  const { service } = build();
  const { batch } = await service.create(USER, destructivePlan);

  assert.equal((await service.reject(USER, batch.id)).status, 'rejected');
  assert.equal((await service.reject(USER, batch.id)).status, 'rejected');
  await assert.rejects(() => service.apply(USER, batch.id), AiActionBatchStateConflictError);
});

test('an undone batch cannot be applied or have results recorded again', async () => {
  const { service } = build();
  const { batch } = await service.create(USER, safePlan);
  await service.undo(USER, batch.id);

  await assert.rejects(() => service.apply(USER, batch.id), AiActionBatchStateConflictError);
  await assert.rejects(() => service.recordResults(USER, batch.id, []), AiActionBatchStateConflictError);
});

test('an empty or oversized plan is rejected before it reaches the journal', async () => {
  const { service } = build();
  await assert.rejects(() => service.create(USER, { ...safePlan, items: [] }));
  await assert.rejects(() => service.create(USER, {
    ...safePlan,
    items: Array.from({ length: 201 }, (_, i) => ({
      actionId: `a${i}`, type: 'create_task' as const, entityKind: 'task' as const,
      entityId: null, projectId: null, title: 't',
    })),
  }));
});

test('a plan without a message id needs an explicit idempotency key', async () => {
  const { service } = build();
  await assert.rejects(() => service.create(USER, { ...safePlan, messageId: null }));
  const result = await service.create(USER, { ...safePlan, messageId: null, idempotencyKey: 'fp-abc' });
  assert.equal(result.batch.idempotencyKey, 'fp-abc');
});
