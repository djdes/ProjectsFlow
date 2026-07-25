import assert from 'node:assert/strict';
import test from 'node:test';
import { CommitSyncJobCleanup } from './CommitSyncJobCleanup.js';
import { FlushCommitSyncBatch } from './FlushCommitSyncBatch.js';
import { SendWorkspaceCommitReview } from './SendWorkspaceCommitReview.js';
import { serializeCommitReviewResult, type CommitReviewResult } from './CommitReviewResult.js';
import type { CommitSyncJob, CommitSyncStatus } from '../../domain/commit-sync/CommitSyncJob.js';

const MIN = 60 * 1000;

type Job = {
  id: string;
  batchKey: string | null;
  status: CommitSyncStatus;
  reviewJson: string | null;
  batchFlushedAt: Date | null;
  claimedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  createdAt: Date;
};

// In-memory repo reproducing the SQL semantics the cleanup + flush rely on. Only the fields those
// paths read are modelled; casts to CommitSyncJob keep the port surface honest.
class FakeRepo {
  readonly jobs = new Map<string, Job>();
  now = new Date();

  add(job: Partial<Job> & Pick<Job, 'id' | 'status' | 'createdAt'>): void {
    this.jobs.set(job.id, {
      batchKey: null,
      reviewJson: null,
      batchFlushedAt: null,
      claimedAt: null,
      finishedAt: null,
      error: null,
      ...job,
    });
  }

  private all(): Job[] {
    return [...this.jobs.values()];
  }

  private pending(j: Job): boolean {
    return j.status === 'queued' || j.status === 'running';
  }

  // --- cleanup surface ---

  async cancelStalledBatches(input: { stalledBefore: Date }): Promise<number> {
    const byKey = new Map<string, Job[]>();
    for (const j of this.all()) {
      if (j.batchKey === null) continue;
      let members = byKey.get(j.batchKey);
      if (!members) byKey.set(j.batchKey, (members = []));
      members.push(j);
    }
    let cancelled = 0;
    for (const members of byKey.values()) {
      if (!members.some((j) => this.pending(j))) continue;
      const minCreated = Math.min(...members.map((j) => j.createdAt.getTime()));
      const maxFinished = maxTime(members.map((j) => j.finishedAt));
      const maxClaimed = maxTime(members.map((j) => j.claimedAt));
      const lastActivity = Math.max(maxFinished ?? minCreated, maxClaimed ?? minCreated);
      if (lastActivity < input.stalledBefore.getTime()) {
        for (const j of members) {
          if (this.pending(j)) {
            this.markCancelled(j);
            cancelled++;
          }
        }
      }
    }
    return cancelled;
  }

  async cancelStale(input: {
    olderThan: Date;
    statuses: ReadonlyArray<Extract<CommitSyncStatus, 'queued' | 'running'>>;
    onlyUnbatched?: boolean;
  }): Promise<number> {
    let cancelled = 0;
    for (const j of this.all()) {
      if (!input.statuses.includes(j.status as 'queued' | 'running')) continue;
      if (j.createdAt.getTime() >= input.olderThan.getTime()) continue;
      if (input.onlyUnbatched && j.batchKey !== null) continue;
      this.markCancelled(j);
      cancelled++;
    }
    return cancelled;
  }

  async deleteTerminal(input: { olderThan: Date }): Promise<number> {
    let deleted = 0;
    for (const j of this.all()) {
      const terminal = j.status === 'succeeded' || j.status === 'failed' || j.status === 'cancelled';
      if (terminal && j.createdAt.getTime() < input.olderThan.getTime()) {
        this.jobs.delete(j.id);
        deleted++;
      }
    }
    return deleted;
  }

  private markCancelled(j: Job): void {
    j.status = 'cancelled';
    j.error = 'dispatcher_timeout';
    j.finishedAt = this.now;
  }

  // --- flush surface ---

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
    for (const j of this.all()) if (j.batchKey !== null) keys.add(j.batchKey);
    return [...keys].filter((key) => {
      const batch = this.all().filter((j) => j.batchKey === key);
      return !batch.some((j) => this.pending(j)) && !batch.some((j) => j.batchFlushedAt !== null);
    });
  }
}

function maxTime(dates: Array<Date | null>): number | null {
  const times = dates.filter((d): d is Date => d !== null).map((d) => d.getTime());
  return times.length ? Math.max(...times) : null;
}

function harness(repo: FakeRepo) {
  const rich: Array<{ chatId: number; html: string }> = [];
  const plain: Array<{ chatId: number; text: string }> = [];
  const sendReview = new SendWorkspaceCommitReview({
    telegram: {
      async sendRichMessage(input: { chatId: number; html: string }) {
        rich.push(input);
        return { kind: 'ok' as const, messageId: 1 };
      },
      async sendMessage(input: { chatId: number; text: string }) {
        plain.push(input);
        return { kind: 'ok' as const, messageId: 2 };
      },
    } as never,
    telegramDigestActions: { async attach() {} } as never,
  });
  const flush = new FlushCommitSyncBatch({ commitSyncJobs: repo as never, sendReview });
  const cleanup = new CommitSyncJobCleanup({ commitSyncJobs: repo as never, flush });
  return { cleanup, rich, plain };
}

function reviewJson(name: string): string {
  const payload: CommitReviewResult = {
    chatId: -100,
    projectName: name,
    mode: 'auto',
    rows: [{ title: `Задача ${name}`, openUrl: 'https://app/open', completeUrl: null }],
  };
  return serializeCommitReviewResult(payload);
}

const BATCH_KEY = '-100:2026-07-24:19:28';

test('(а) batch with a recent completion is NOT cancelled', async () => {
  const now = new Date('2026-07-24T13:00:00Z');
  const repo = new FakeRepo();
  repo.now = now;
  // One job finished 2 min ago (fresh activity), a sibling still queued from 30 min ago.
  repo.add({
    id: 'done',
    batchKey: BATCH_KEY,
    status: 'succeeded',
    createdAt: new Date(now.getTime() - 30 * MIN),
    finishedAt: new Date(now.getTime() - 2 * MIN),
  });
  repo.add({
    id: 'pending',
    batchKey: BATCH_KEY,
    status: 'queued',
    createdAt: new Date(now.getTime() - 30 * MIN),
  });
  const { cleanup } = harness(repo);

  const res = await cleanup.runOnce(now);
  assert.equal(res.cancelled, 0);
  assert.equal(repo.jobs.get('pending')!.status, 'queued');
});

test('(б) batch with no activity > STALL is cancelled and then flushed', async () => {
  const now = new Date('2026-07-24T13:00:00Z');
  const repo = new FakeRepo();
  repo.now = now;
  // Two queued jobs, never claimed, created 20 min ago → last activity = created_at (stalled).
  repo.add({ id: 'a', batchKey: BATCH_KEY, status: 'queued', createdAt: new Date(now.getTime() - 20 * MIN) });
  repo.add({ id: 'b', batchKey: BATCH_KEY, status: 'queued', createdAt: new Date(now.getTime() - 20 * MIN) });
  const { cleanup, plain } = harness(repo);

  const res = await cleanup.runOnce(now);
  assert.equal(res.cancelled, 2);
  assert.equal(repo.jobs.get('a')!.status, 'cancelled');
  assert.equal(repo.jobs.get('b')!.status, 'cancelled');
  assert.equal(repo.jobs.get('a')!.error, 'dispatcher_timeout');
  // Sweep closed the batch: no results to digest → short conclusion instead of silence.
  assert.equal(res.flushed, 1);
  assert.equal(plain.length, 1);
  assert.match(plain[0]!.text, /Не обработано: 2/);
});

test('(в) a runner finishing a job every few minutes is never cut off, even over an hour', async () => {
  const base = new Date('2026-07-24T13:00:00Z');
  const repo = new FakeRepo();
  // 12 jobs enqueued at t0; 11 will finish one every 6 min (66 min total), 1 stays queued throughout.
  for (let i = 0; i < 12; i++) {
    repo.add({ id: `j${i}`, batchKey: BATCH_KEY, status: 'queued', createdAt: base });
  }
  const { cleanup } = harness(repo);

  let totalCancelled = 0;
  for (let i = 0; i < 11; i++) {
    const now = new Date(base.getTime() + (i + 1) * 6 * MIN);
    repo.now = now;
    // Runner finishes one job at this tick (fresh activity).
    const job = repo.jobs.get(`j${i}`)!;
    job.status = 'succeeded';
    job.finishedAt = now;
    const res = await cleanup.runOnce(now);
    totalCancelled += res.cancelled;
  }
  // Despite the queued straggler being 66 min old, steady progress kept the batch alive.
  assert.equal(totalCancelled, 0);
  assert.equal(repo.jobs.get('j11')!.status, 'queued');
});

test('(г) a single manual job is cancelled by age', async () => {
  const now = new Date('2026-07-24T13:00:00Z');
  const repo = new FakeRepo();
  repo.now = now;
  repo.add({ id: 'old', batchKey: null, status: 'queued', createdAt: new Date(now.getTime() - 20 * MIN) });
  repo.add({ id: 'fresh', batchKey: null, status: 'queued', createdAt: new Date(now.getTime() - 5 * MIN) });
  const { cleanup } = harness(repo);

  const res = await cleanup.runOnce(now);
  assert.equal(res.cancelled, 1);
  assert.equal(repo.jobs.get('old')!.status, 'cancelled');
  // Younger than the 15 min single window → left alone.
  assert.equal(repo.jobs.get('fresh')!.status, 'queued');
});

test('(д) absolute backstop cancels an old job despite recent activity', async () => {
  const now = new Date('2026-07-24T13:00:00Z');
  const repo = new FakeRepo();
  repo.now = now;
  // Batch churns fresh activity (claimed/finished 1 min ago) so stall does NOT fire, but a member
  // has been unfinished for 100 min → the hard ceiling closes it.
  repo.add({
    id: 'stuck',
    batchKey: BATCH_KEY,
    status: 'running',
    createdAt: new Date(now.getTime() - 100 * MIN),
    claimedAt: new Date(now.getTime() - 1 * MIN),
  });
  repo.add({
    id: 'fresh-done',
    batchKey: BATCH_KEY,
    status: 'succeeded',
    reviewJson: reviewJson('OrdersFlow'),
    createdAt: new Date(now.getTime() - 100 * MIN),
    finishedAt: new Date(now.getTime() - 1 * MIN),
  });
  const { cleanup, rich } = harness(repo);

  const res = await cleanup.runOnce(now);
  assert.equal(repo.jobs.get('stuck')!.status, 'cancelled');
  assert.ok(res.cancelled >= 1);
  // Batch is now terminal → sweep ships the digest for the finished project.
  assert.equal(rich.length, 1);
  assert.match(rich[0]!.html, /OrdersFlow/);
});
