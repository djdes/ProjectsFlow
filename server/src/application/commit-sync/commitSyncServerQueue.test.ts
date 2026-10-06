import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitSyncServerQueue } from './commitSyncServerQueue.js';
import { ListPendingCommitSyncJobs } from './ListPendingCommitSyncJobs.js';
import type { CommitSyncJobRepository, QueuedCommitSyncJob } from './CommitSyncJobRepository.js';
import type { CommitSyncJob } from '../../domain/commit-sync/CommitSyncJob.js';
import {
  CommitSyncJobAlreadyClaimedError,
  CommitSyncJobNotFoundError,
} from '../../domain/commit-sync/errors.js';
import { PlanRequiredError, UsageBlockedError } from '../../domain/usage/errors.js';

function queued(id: string, dispatcherUserId: string, createdBy: string | null): QueuedCommitSyncJob {
  return { id, projectId: `p-${id}`, createdBy, dispatcherUserId, createdAt: new Date('2026-10-06T14:00:00Z') };
}

function harness(
  jobs: QueuedCommitSyncJob[],
  claimBehaviour: (jobId: string) => Error | null,
) {
  const claims: Array<{ userId: string; jobId: string }> = [];
  const executed: string[] = [];
  let clock = 0;
  const adapter = commitSyncServerQueue({
    commitSyncJobs: { listQueued: async () => jobs },
    claim: {
      async execute(input) {
        claims.push(input);
        const error = claimBehaviour(input.jobId);
        if (error) throw error;
        return { id: input.jobId, dispatcherUserId: input.userId } as CommitSyncJob;
      },
    },
    run: { execute: async (job) => void executed.push(job.id) },
    now: () => clock,
  });
  return { adapter, claims, executed, advance: (ms: number) => (clock += ms) };
}

test('claim: job’ы всех диспетчеров забираются от имени их диспетчера, не больше limit', async () => {
  const h = harness([queued('j1', 'disp-a', 'owner-1'), queued('j2', 'disp-b', 'owner-2'), queued('j3', 'disp-a', null)], () => null);
  assert.equal(h.adapter.queue, 'commit_sync');
  const tasks = await h.adapter.claim(2);
  assert.deepEqual(h.claims, [
    { userId: 'disp-a', jobId: 'j1' },
    { userId: 'disp-b', jobId: 'j2' },
  ]);
  assert.equal(tasks.length, 2);
  for (const task of tasks) await task();
  assert.deepEqual(h.executed, ['j1', 'j2']);
  assert.deepEqual(await h.adapter.claim(0), []);
});

test('гейт тарифа: job остаётся в очереди, не загораживает остальные; отказ перепроверяется раз в минуту', async () => {
  const h = harness(
    [queued('j1', 'disp', 'free-owner'), queued('j2', 'disp', 'free-owner'), queued('j3', 'disp', 'paid-owner'), queued('j4', 'disp', 'blocked-owner')],
    (jobId) =>
      jobId === 'j1' || jobId === 'j2'
        ? new PlanRequiredError()
        : jobId === 'j4'
          ? new UsageBlockedError('5h', null)
          : null,
  );
  const first = await h.adapter.claim(3);
  // j2 того же плательщика уже не проверяем — отказ запомнен.
  assert.deepEqual(h.claims.map((c) => c.jobId), ['j1', 'j3', 'j4']);
  assert.equal(first.length, 1);

  h.claims.length = 0;
  h.advance(30_000);
  await h.adapter.claim(3);
  assert.deepEqual(h.claims.map((c) => c.jobId), ['j3']);

  h.claims.length = 0;
  h.advance(31_000);
  await h.adapter.claim(3);
  assert.deepEqual(h.claims.map((c) => c.jobId), ['j1', 'j3', 'j4']);
});

test('гонка: job, забранный диспетчером или удалённый очисткой, пропускается', async () => {
  const h = harness([queued('j1', 'd', 'o'), queued('j2', 'd', 'o'), queued('j3', 'd', 'o')], (jobId) =>
    jobId === 'j1'
      ? new CommitSyncJobAlreadyClaimedError(jobId)
      : jobId === 'j2'
        ? new CommitSyncJobNotFoundError(jobId)
        : null,
  );
  const tasks = await h.adapter.claim(3);
  assert.equal(tasks.length, 1);
  await tasks[0]!();
  assert.deepEqual(h.executed, ['j3']);
});

test('сбой БД: уже забранные job’ы отдаются исполнителям, без них ошибка уходит раннеру', async () => {
  const dbDown = new Error('connection lost');
  const partial = harness([queued('j1', 'd', 'o'), queued('j2', 'd', 'o'), queued('j3', 'd', 'o')], (jobId) =>
    jobId === 'j2' ? dbDown : null,
  );
  const tasks = await partial.adapter.claim(3);
  assert.equal(tasks.length, 1);
  assert.deepEqual(partial.claims.map((c) => c.jobId), ['j1', 'j2']);

  const none = harness([queued('j1', 'd', 'o')], () => dbDown);
  await assert.rejects(none.adapter.claim(3), /connection lost/);
});

test('ListPendingCommitSyncJobs: пока очередь у сервера, диспетчер получает пустой список', async () => {
  const listed: Array<{ userId: string; limit: number }> = [];
  const repo = {
    async listPendingForDispatcher(userId: string, limit: number) {
      listed.push({ userId, limit });
      return [{ id: 'j1', projectId: 'p1', projectName: 'Сайт', createdAt: new Date() }];
    },
  } as unknown as CommitSyncJobRepository;

  const serverOwned = new ListPendingCommitSyncJobs({ commitSyncJobs: repo, serverHandles: async () => true });
  assert.deepEqual(await serverOwned.execute({ userId: 'disp' }), []);
  assert.equal(listed.length, 0);

  const dispatcherOwned = new ListPendingCommitSyncJobs({ commitSyncJobs: repo, serverHandles: async () => false });
  assert.equal((await dispatcherOwned.execute({ userId: 'disp', limit: 500 })).length, 1);
  // Политику не удалось прочитать — job'ы остаются диспетчеру.
  const unknown = new ListPendingCommitSyncJobs({
    commitSyncJobs: repo,
    serverHandles: async () => {
      throw new Error('settings unavailable');
    },
  });
  assert.equal((await unknown.execute({ userId: 'disp' })).length, 1);
  // Без зависимости — прежнее поведение.
  assert.equal((await new ListPendingCommitSyncJobs({ commitSyncJobs: repo }).execute({ userId: 'disp' })).length, 1);
  assert.deepEqual(listed, [
    { userId: 'disp', limit: 50 },
    { userId: 'disp', limit: 10 },
    { userId: 'disp', limit: 10 },
  ]);
});
