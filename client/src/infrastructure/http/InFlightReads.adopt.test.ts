import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InFlightReads } from './InFlightReads';

test('a read started elsewhere is shared while in flight, then forgotten', async () => {
  const reads = new InFlightReads();
  let resolve!: (value: string) => void;
  const started = new Promise<string>((r) => {
    resolve = r;
  });
  reads.adopt('k', started);
  let loads = 0;
  const joined = reads.get('k', async () => {
    loads += 1;
    return 'own request';
  });
  resolve('fetched ahead');
  assert.equal(await joined, 'fetched ahead');
  assert.equal(loads, 0, 'no second request while it was in flight');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(await reads.get('k', async () => 'later'), 'later', 'settled: the next read asks itself');
});

test('a failed adopted read does not surface as unhandled and is forgotten', async () => {
  const reads = new InFlightReads();
  const failing = Promise.reject(new Error('offline'));
  failing.catch(() => undefined);
  reads.adopt('k', failing);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(await reads.get('k', async () => 'retry'), 'retry');
});
