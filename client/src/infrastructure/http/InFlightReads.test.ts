import assert from 'node:assert/strict';
import test from 'node:test';
import { InFlightReads } from './InFlightReads';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('concurrent reads share one request, but settled data is never cached', async () => {
  const reads = new InFlightReads();
  const first = deferred<number>();
  let calls = 0;
  const load = () => {
    calls += 1;
    return first.promise;
  };
  const a = reads.get('a', load);
  assert.equal(reads.get('a', load), a);
  await Promise.resolve();
  assert.equal(calls, 1);
  first.resolve(1);
  assert.equal(await a, 1);
  assert.equal(await reads.get('a', async () => 2), 2);
  assert.equal(await reads.get('b', async () => 3), 3);
});

test('invalidation separates sessions/mutations and old completion cannot evict a new request', async () => {
  const reads = new InFlightReads();
  const before = deferred<number>();
  const after = deferred<number>();
  const a = reads.get('private', () => before.promise);
  reads.invalidate();
  const b = reads.get('private', () => after.promise);
  assert.notEqual(a, b);
  before.resolve(1);
  await a;
  assert.equal(
    reads.get('private', async () => 99),
    b,
  );
  after.resolve(2);
  assert.equal(await b, 2);
});

test('failed requests can be retried', async () => {
  const reads = new InFlightReads();
  await assert.rejects(
    reads.get('a', async () => {
      throw new Error('offline');
    }),
    /offline/,
  );
  assert.equal(await reads.get('a', async () => 'online'), 'online');
});
