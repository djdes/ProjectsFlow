import assert from 'node:assert/strict';
import test from 'node:test';
import type { ApprovalSummary } from '@/domain/approval/ApprovalSummary';
import type { ApprovalSummaryRepository } from './ApprovalSummaryRepository';
import { LoadApprovalSummary } from './LoadApprovalSummary';

function repository(reply: (taskId: string) => Promise<ApprovalSummary>): { repo: ApprovalSummaryRepository; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    repo: {
      get: (_projectId, taskId) => {
        calls.push(taskId);
        return reply(taskId);
      },
    },
  };
}

const ready = (summary: string | null): ApprovalSummary => ({ summary, generatedAt: summary ? new Date('2026-11-17T09:00:00Z') : null });

test('re-renders and parallel cards share one request and the cached value', async () => {
  const { repo, calls } = repository(async () => ready('Страница врачей готова.'));
  const load = new LoadApprovalSummary(repo);
  const key = { projectId: 'p1', taskId: 't1', revision: '1' };
  assert.equal(load.peek(key), undefined);
  const [a, b] = await Promise.all([load.execute(key), load.execute(key)]);
  assert.equal(a.summary, 'Страница врачей готова.');
  assert.equal(b, a);
  assert.equal(load.peek(key)?.summary, 'Страница врачей готова.');
  await load.execute(key);
  assert.deepEqual(calls, ['t1']);
});

test('a new task revision asks again', async () => {
  const { repo, calls } = repository(async () => ready('x'));
  const load = new LoadApprovalSummary(repo);
  await load.execute({ projectId: 'p1', taskId: 't1', revision: '1' });
  await load.execute({ projectId: 'p1', taskId: 't1', revision: '2' });
  assert.deepEqual(calls, ['t1', 't1']);
});

test('an empty summary expires after a short while, a network error is not cached', async () => {
  let clock = 0;
  let fail = true;
  const { repo, calls } = repository(async () => {
    if (fail) throw new Error('offline');
    return ready(null);
  });
  const load = new LoadApprovalSummary(repo, () => clock);
  const key = { projectId: 'p1', taskId: 't1' };
  await assert.rejects(() => load.execute(key), /offline/);
  assert.equal(load.peek(key), undefined);

  fail = false;
  assert.equal((await load.execute(key)).summary, null);
  clock += 60_000;
  assert.equal(load.peek(key)?.summary, null);
  clock += 2 * 60_000;
  assert.equal(load.peek(key), undefined);
  await load.execute(key);
  assert.equal(calls.length, 3);
});
