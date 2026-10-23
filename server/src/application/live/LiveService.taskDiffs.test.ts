import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LiveService, type LiveServiceDeps } from './LiveService.js';
import type { LiveEventInput } from '../../domain/live/LiveEvent.js';

function harness(fail = false) {
  const events: LiveEventInput[] = [];
  const statuses: string[] = [];
  const service = new LiveService({
    access: { projects: { getById: async () => ({ id: 'p', dispatcherUserId: 'd' }) }, members: {} },
    repo: {
      getSession: async () => ({ id: 's', taskId: 't', projectId: 'p', lastSeq: 10, eventCount: 10 }),
      appendEvent: async ({ event }: { event: LiveEventInput }) => { events.push(event); return true; },
      bumpSession: async () => {},
      finishSession: async (_id: string, input: { status: string }) => { statuses.push(input.status); },
    },
    runDiffs: { execute: async () => {
      if (fail) throw new Error('secret source diagnostic');
      return [{ path: 'own.ts', change: 'modified', additions: 4, deletions: 34 }];
    } },
    liveEventHub: { publish() {}, publishEnd() {} },
    broadcaster: { broadcastLiveSessionChanged: async () => {} },
  } as unknown as LiveServiceDeps);
  return { service, events, statuses };
}
const unverified = { status: 'completed' as const, fileDiffs: [{ path: 'unrelated.ts', change: 'modified' as const, additions: 1315, deletions: 71 }] };

test('completion ignores the checkout-wide payload and persists verified task changes', async () => {
  const h = harness();
  await h.service.finishSession('p', 'd', 't', 's', unverified);
  const diffs = h.events.filter(event => event.kind === 'file_diff');
  assert.equal(diffs.length, 1);
  assert.equal((diffs[0]?.payload as { path: string }).path, 'own.ts');
  assert.doesNotMatch(JSON.stringify(h.events), /unrelated/);
  assert.deepEqual(h.statuses, ['completed']);
});

test('source failure completes the worker with an explicit safe notice and no invented diff', async () => {
  const h = harness(true);
  await h.service.finishSession('p', 'd', 't', 's', unverified);
  assert.deepEqual(h.statuses, ['completed']);
  assert.deepEqual(h.events.map(event => event.kind), ['worker_notice']);
  assert.doesNotMatch(JSON.stringify(h.events), /unrelated|secret source diagnostic/);
});
