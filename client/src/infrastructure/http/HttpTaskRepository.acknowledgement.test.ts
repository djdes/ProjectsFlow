import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpTaskRepository } from './HttpTaskRepository';

test('HTTP acknowledgement: authenticated resource route, typed dates and list round-trip', async () => {
  const previous = globalThis.fetch;
  const calls: { path: string; method: string; credentials?: RequestCredentials }[] = [];
  const ack = { commentId: 'c', userId: 'me', displayName: 'Денис', acknowledgedAt: '2026-10-23T10:00:00.000Z' };
  globalThis.fetch = (async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method ?? 'GET', credentials: init?.credentials });
    return new Response(JSON.stringify(init?.method === 'GET' ? { comments: [{ id: 'c', createdAt: ack.acknowledgedAt, updatedAt: ack.acknowledgedAt, acknowledgements: [ack] }] }
      : { acknowledgements: init?.method === 'DELETE' ? [] : [ack] }), { status: 200 });
  }) as typeof fetch;
  try {
    const repo = new HttpTaskRepository();
    const result = await repo.setCommentAcknowledged('p', 't', 'c', true);
    assert.ok(result[0]!.acknowledgedAt instanceof Date);
    assert.equal(result[0]!.acknowledgedAt.toISOString(), ack.acknowledgedAt);
    assert.equal((await repo.listComments('p', 't'))[0]!.acknowledgements![0]!.acknowledgedAt.toISOString(), ack.acknowledgedAt);
    assert.deepEqual(await repo.setCommentAcknowledged('p', 't', 'c', false), []);
    assert.deepEqual(calls.map(c => c.method), ['PUT', 'GET', 'DELETE']);
    assert.equal(calls[0]!.path, '/api/projects/p/tasks/t/comments/c/acknowledgement');
    assert.ok(calls.every(c => c.credentials === 'include'));
  } finally { globalThis.fetch = previous; }
});
