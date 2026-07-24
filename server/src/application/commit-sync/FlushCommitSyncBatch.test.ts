import assert from 'node:assert/strict';
import test from 'node:test';
import { FlushCommitSyncBatch } from './FlushCommitSyncBatch.js';
import { SendWorkspaceCommitReview } from './SendWorkspaceCommitReview.js';
import {
  serializeCommitReviewResult,
  type CommitReviewResult,
} from './CommitReviewResult.js';
import type { CommitSyncJob, CommitSyncStatus } from '../../domain/commit-sync/CommitSyncJob.js';

const NOW = new Date('2026-07-24T13:00:00Z');

type MutableJob = {
  id: string;
  batchKey: string | null;
  status: CommitSyncStatus;
  reviewJson: string | null;
  batchFlushedAt: Date | null;
};

// In-memory репозиторий, воспроизводящий семантику батч-election из Drizzle-реализации:
// весь батч гасится атомарно (все строки), только если нет незавершённых job'ов и флаг ещё NULL.
class FakeRepo {
  readonly jobs = new Map<string, MutableJob>();

  add(job: MutableJob): void {
    this.jobs.set(job.id, job);
  }

  private all(): MutableJob[] {
    return [...this.jobs.values()];
  }

  private pending(job: MutableJob): boolean {
    return job.status === 'queued' || job.status === 'running';
  }

  async findById(id: string): Promise<CommitSyncJob | null> {
    const j = this.jobs.get(id);
    return j ? (j as unknown as CommitSyncJob) : null;
  }

  async listByBatchKey(batchKey: string): Promise<CommitSyncJob[]> {
    return this.all().filter((j) => j.batchKey === batchKey) as unknown as CommitSyncJob[];
  }

  async tryMarkBatchFlushed(batchKey: string): Promise<boolean> {
    const batch = this.all().filter((j) => j.batchKey === batchKey);
    if (batch.length === 0) return false;
    if (batch.some((j) => this.pending(j))) return false;
    if (batch.some((j) => j.batchFlushedAt !== null)) return false;
    for (const j of batch) j.batchFlushedAt = new Date();
    return true;
  }

  async tryMarkJobFlushed(jobId: string): Promise<boolean> {
    const j = this.jobs.get(jobId);
    if (!j || this.pending(j) || j.batchFlushedAt !== null) return false;
    j.batchFlushedAt = new Date();
    return true;
  }

  async findFlushableBatchKeys(): Promise<string[]> {
    const keys = new Set<string>();
    for (const j of this.all()) {
      if (j.batchKey === null) continue;
      keys.add(j.batchKey);
    }
    return [...keys].filter((key) => {
      const batch = this.all().filter((j) => j.batchKey === key);
      return !batch.some((j) => this.pending(j)) && !batch.some((j) => j.batchFlushedAt !== null);
    });
  }
}

function harness(repo: FakeRepo) {
  const rich: Array<{ chatId: number; html: string }> = [];
  const sendReview = new SendWorkspaceCommitReview({
    telegram: {
      async sendRichMessage(input: { chatId: number; html: string }) {
        rich.push(input);
        return { kind: 'ok' as const, messageId: 1 };
      },
      async sendMessage() {
        return { kind: 'ok' as const, messageId: 2 };
      },
    } as never,
    telegramDigestActions: { async attach() {} } as never,
  });
  const flush = new FlushCommitSyncBatch({
    commitSyncJobs: repo as never,
    sendReview,
    now: () => NOW,
  });
  return { flush, rich };
}

function result(name: string, mode: 'auto' | 'propose'): string {
  const payload: CommitReviewResult = {
    chatId: -100,
    projectName: name,
    mode,
    rows: [{ title: `Задача ${name}`, openUrl: 'https://app/open', completeUrl: null }],
  };
  return serializeCommitReviewResult(payload);
}

test('(а) two projects of one batch → last completion sends ONE message with both', async () => {
  const repo = new FakeRepo();
  repo.add({ id: 'a', batchKey: 'B', status: 'succeeded', reviewJson: result('OrdersFlow', 'auto'), batchFlushedAt: null });
  repo.add({ id: 'b', batchKey: 'B', status: 'succeeded', reviewJson: result('DocsFlow', 'propose'), batchFlushedAt: null });
  const { flush, rich } = harness(repo);

  await flush.flushForJob((await repo.findById('b'))!);

  assert.equal(rich.length, 1);
  assert.equal(rich[0]!.html.match(/<details>/g)?.length, 2);
  assert.match(rich[0]!.html, /OrdersFlow/);
  assert.match(rich[0]!.html, /DocsFlow/);
});

test('collector guard: a still-running sibling keeps the batch silent', async () => {
  const repo = new FakeRepo();
  repo.add({ id: 'a', batchKey: 'B', status: 'succeeded', reviewJson: result('OrdersFlow', 'auto'), batchFlushedAt: null });
  repo.add({ id: 'b', batchKey: 'B', status: 'running', reviewJson: null, batchFlushedAt: null });
  const { flush, rich } = harness(repo);

  await flush.flushForJob((await repo.findById('a'))!);
  assert.equal(rich.length, 0);

  // Второй завершается → он и есть сборщик, шлёт одно сообщение.
  repo.jobs.get('b')!.status = 'succeeded';
  repo.jobs.get('b')!.reviewJson = result('DocsFlow', 'propose');
  await flush.flushForJob((await repo.findById('b'))!);
  assert.equal(rich.length, 1);
  assert.equal(rich[0]!.html.match(/<details>/g)?.length, 2);
});

test('double flush of the same batch sends only once', async () => {
  const repo = new FakeRepo();
  repo.add({ id: 'a', batchKey: 'B', status: 'succeeded', reviewJson: result('OrdersFlow', 'auto'), batchFlushedAt: null });
  const { flush, rich } = harness(repo);

  await flush.flushBatch('B');
  await flush.flushBatch('B');
  assert.equal(rich.length, 1);
});

test('(д) manual run (no batch_key) is sent immediately, without waiting for a batch', async () => {
  const repo = new FakeRepo();
  repo.add({ id: 'm', batchKey: null, status: 'succeeded', reviewJson: result('OrdersFlow', 'propose'), batchFlushedAt: null });
  const { flush, rich } = harness(repo);

  await flush.flushForJob((await repo.findById('m'))!);
  assert.equal(rich.length, 1);
  assert.equal(rich[0]!.html.match(/<details>/g)?.length, 1);
});

test('(г) a fully clean batch stays silent', async () => {
  const repo = new FakeRepo();
  repo.add({ id: 'a', batchKey: 'B', status: 'succeeded', reviewJson: null, batchFlushedAt: null });
  repo.add({ id: 'b', batchKey: 'B', status: 'failed', reviewJson: null, batchFlushedAt: null });
  const { flush, rich } = harness(repo);

  await flush.flushForJob((await repo.findById('b'))!);
  // Батч помечен отправленным (election сработал), но сообщения нет — показывать нечего.
  assert.equal(rich.length, 0);
});

test('clean project is dropped, non-clean sibling still ships', async () => {
  const repo = new FakeRepo();
  repo.add({ id: 'a', batchKey: 'B', status: 'succeeded', reviewJson: null, batchFlushedAt: null });
  repo.add({ id: 'b', batchKey: 'B', status: 'succeeded', reviewJson: result('DocsFlow', 'auto'), batchFlushedAt: null });
  const { flush, rich } = harness(repo);

  await flush.flushForJob((await repo.findById('b'))!);
  assert.equal(rich.length, 1);
  assert.equal(rich[0]!.html.match(/<details>/g)?.length, 1);
  assert.match(rich[0]!.html, /DocsFlow/);
});

test('(е) safety sweep ships a batch orphaned by a stuck job that was cancelled', async () => {
  const repo = new FakeRepo();
  // Один job завершился с результатом, второй завис и был добит cleanup'ом (cancelled).
  repo.add({ id: 'a', batchKey: 'B', status: 'succeeded', reviewJson: result('OrdersFlow', 'auto'), batchFlushedAt: null });
  repo.add({ id: 'b', batchKey: 'B', status: 'running', reviewJson: null, batchFlushedAt: null });
  const { flush, rich } = harness(repo);

  // Пока 'b' крутится — сборка не срабатывает.
  await flush.sweep();
  assert.equal(rich.length, 0);

  // cleanup.cancelStale добивает зависший job → батч становится полностью терминальным.
  repo.jobs.get('b')!.status = 'cancelled';
  const flushed = await flush.sweep();
  assert.equal(flushed, 1);
  assert.equal(rich.length, 1);
  assert.match(rich[0]!.html, /OrdersFlow/);

  // Повторный sweep уже ничего не шлёт (батч помечен flushed).
  await flush.sweep();
  assert.equal(rich.length, 1);
});
