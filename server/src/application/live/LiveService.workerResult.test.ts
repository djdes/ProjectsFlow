import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveService, type LiveServiceDeps } from './LiveService.js';
import type { LiveSessionFinalStatus } from '../../domain/live/LiveSession.js';

function harness(failDelivery = false) {
  const finished: string[] = [];
  const requested: string[] = [];
  const service = new LiveService({
    access: {
      projects: { async getById() { return { id: 'p', dispatcherUserId: 'dispatcher' }; } },
      members: {},
    },
    repo: {
      async getSession() { return { id: 's', projectId: 'p', taskId: 't', lastSeq: 0, eventCount: 0 }; },
      async finishSession(_id: string, input: { status: string }) { finished.push(input.status); },
    },
    liveEventHub: { publishEnd() {} },
    broadcaster: { async broadcastLiveSessionChanged() {} },
    workerResults: {
      async request(taskId: string, userId: string) {
        assert.equal(finished.at(-1), 'completed', 'completion is persisted before requesting delivery');
        requested.push(`${taskId}:${userId}`);
        if (failDelivery) throw new Error('temporary outbox outage');
      },
    },
  } as unknown as LiveServiceDeps);
  return { service, finished, requested };
}

test('LIVE completion queues the group report without a separate personal-notification request', async () => {
  const h = harness();
  await h.service.finishSession('p', 'dispatcher', 't', 's', { status: 'completed' });
  assert.deepEqual(h.requested, ['t:dispatcher']);
});

test('failed, canceled and timed-out runs do not announce successful completion', async () => {
  for (const status of ['failed', 'canceled', 'timeout'] satisfies LiveSessionFinalStatus[]) {
    const h = harness();
    await h.service.finishSession('p', 'dispatcher', 't', 's', { status });
    assert.deepEqual(h.finished, [status]);
    assert.deepEqual(h.requested, []);
  }
});

test('a temporary report failure does not reject the persisted LIVE completion', async () => {
  const h = harness(true);
  assert.deepEqual(await h.service.finishSession('p', 'dispatcher', 't', 's', { status: 'completed' }), { ok: true });
  assert.deepEqual(h.finished, ['completed']);
});

test('an unauthorized member cannot finish a run or queue a group report', async () => {
  const h = harness();
  await assert.rejects(() => h.service.finishSession('p', 'member', 't', 's', { status: 'completed' }), { name: 'NotAssignedDispatcherError' });
  assert.deepEqual(h.finished, []);
  assert.deepEqual(h.requested, []);
});

test('ingest and completion publish under the attempt UUID, never the shared task ID', async () => {
  const calls: string[] = [];
  const service = new LiveService({
    access: { projects: { async getById() { return { id: 'p', dispatcherUserId: 'dispatcher' }; } }, members: {} },
    repo: {
      async getSession() { return { id: 'attempt', projectId: 'p', taskId: 't', lastSeq: 0, eventCount: 0 }; },
      async appendEvent() { return true; }, async bumpSession() {}, async finishSession() {},
    },
    liveEventHub: {
      publish(id: string) { calls.push(`events:${id}`); },
      publishEnd(id: string) { calls.push(`end:${id}`); },
    },
    broadcaster: { async broadcastLiveSessionChanged() {} },
  } as unknown as LiveServiceDeps);
  await service.appendEvents('p', 'dispatcher', 't', 'attempt', [{ seq: 1, kind: 'assistant_text', text: 'Проверяю' }]);
  await service.finishSession('p', 'dispatcher', 't', 'attempt', { status: 'completed' });
  assert.deepEqual(calls, ['events:attempt', 'end:attempt']);
});
