import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VapidKeyProvider,
  type StoredVapidKeys,
  type VapidKeyPair,
  type VapidKeyStore,
} from './VapidKeyProvider.js';

class FakeStore implements VapidKeyStore {
  constructor(public state: StoredVapidKeys = { status: 'missing' }, public failLoads = 0) {}
  loads = 0;
  replaced: VapidKeyPair[] = [];
  async load(): Promise<StoredVapidKeys> {
    this.loads += 1;
    if (this.failLoads > 0) {
      this.failLoads -= 1;
      throw new Error('db down');
    }
    return this.state;
  }
  async createIfAbsent(keys: VapidKeyPair): Promise<StoredVapidKeys> {
    if (this.state.status === 'missing') this.state = { status: 'ok', keys };
    return this.state;
  }
  async replace(keys: VapidKeyPair): Promise<void> {
    this.replaced.push(keys);
    this.state = { status: 'ok', keys };
  }
}

function generator() {
  let n = 0;
  return { generate: (): VapidKeyPair => { n += 1; return { publicKey: `pub-${n}`, privateKey: `priv-${n}` }; } };
}

test('generates a pair on first use, stores it and reuses it', async () => {
  const store = new FakeStore();
  const provider = new VapidKeyProvider({ store, generator: generator(), onRotated: async () => {} });

  const [a, b] = await Promise.all([provider.get(), provider.get()]);
  const c = await provider.get();

  assert.deepEqual(a, { publicKey: 'pub-1', privateKey: 'priv-1' });
  assert.deepEqual(b, a);
  assert.deepEqual(c, a);
  assert.deepEqual(store.state, { status: 'ok', keys: a });
  assert.equal(store.loads, 1, 'the pair is cached for the process');
});

test('keeps the pair that is already stored', async () => {
  const store = new FakeStore({ status: 'ok', keys: { publicKey: 'stored-pub', privateKey: 'stored-priv' } });
  const provider = new VapidKeyProvider({ store, generator: generator(), onRotated: async () => {} });
  assert.deepEqual(await provider.get(), { publicKey: 'stored-pub', privateKey: 'stored-priv' });
});

test('environment keys win over the database', async () => {
  const store = new FakeStore();
  const provider = new VapidKeyProvider({
    store,
    generator: generator(),
    env: { publicKey: ' env-pub ', privateKey: 'env-priv' },
    onRotated: async () => {},
  });
  assert.deepEqual(await provider.get(), { publicKey: 'env-pub', privateKey: 'env-priv' });
  assert.equal(store.loads, 0);
});

test('an unreadable private key is replaced and device subscriptions are reset', async () => {
  const store = new FakeStore({ status: 'unreadable' });
  let rotations = 0;
  const provider = new VapidKeyProvider({
    store,
    generator: generator(),
    onRotated: async () => { rotations += 1; },
    log: () => {},
  });
  assert.deepEqual(await provider.get(), { publicKey: 'pub-1', privateKey: 'priv-1' });
  assert.equal(store.replaced.length, 1);
  assert.equal(rotations, 1);
});

test('a failed lookup is retried on the next call', async () => {
  const store = new FakeStore({ status: 'ok', keys: { publicKey: 'p', privateKey: 'k' } }, 1);
  const provider = new VapidKeyProvider({ store, generator: generator(), onRotated: async () => {} });
  await assert.rejects(provider.get(), /db down/);
  assert.deepEqual(await provider.get(), { publicKey: 'p', privateKey: 'k' });
});
