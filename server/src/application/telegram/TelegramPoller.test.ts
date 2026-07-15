import assert from 'node:assert/strict';
import test from 'node:test';
import type { HandleTelegramWebhook } from './HandleTelegramWebhook.js';
import type { TelegramClient, TelegramUpdate } from './TelegramClient.js';
import { TelegramPoller } from './TelegramPoller.js';

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function update(updateId: number): TelegramUpdate {
  return { update_id: updateId };
}

function albumUpdate(updateId: number, messageId: number): TelegramUpdate {
  return {
    update_id: updateId,
    message: {
      message_id: messageId,
      media_group_id: 'album-1',
      chat: { id: 500 },
      from: { id: 111 },
    },
  };
}

test('poller runs one media group concurrently, awaits it, then acknowledges the batch', async () => {
  const offsets: number[] = [];
  const gates = new Map([
    [10, deferred<void>()],
    [11, deferred<void>()],
    [12, deferred<void>()],
  ]);
  const allHandlersStarted = deferred<void>();
  const nextPollStarted = deferred<void>();
  const nextPoll = deferred<TelegramUpdate[]>();
  const started: number[] = [];
  let pollCount = 0;

  const client = {
    async deleteWebhook() {},
    async getUpdates(offset: number) {
      offsets.push(offset);
      if (pollCount++ === 0) return [albumUpdate(12, 102), albumUpdate(10, 100), albumUpdate(11, 101)];
      nextPollStarted.resolve();
      return nextPoll.promise;
    },
  } as unknown as TelegramClient;
  const handler = {
    async execute(value: { update_id: number }) {
      started.push(value.update_id);
      if (started.length === gates.size) allHandlersStarted.resolve();
      await gates.get(value.update_id)?.promise;
    },
  } as unknown as HandleTelegramWebhook;
  const poller = new TelegramPoller({ client, handler, sleep: async () => {} });

  await poller.start();
  try {
    await allHandlersStarted.promise;
    assert.deepEqual(started, [10, 11, 12], 'all album parts start before any one is released');
    assert.deepEqual(offsets, [0], 'offset is not sent to Telegram before handlers finish');

    gates.get(12)?.resolve();
    gates.get(10)?.resolve();
    await Promise.resolve();
    assert.deepEqual(offsets, [0], 'one unfinished handler keeps the batch unacknowledged');

    gates.get(11)?.resolve();
    await nextPollStarted.promise;
    assert.deepEqual(offsets, [0, 13]);
  } finally {
    for (const gate of gates.values()) gate.resolve();
    const stopping = poller.stop();
    nextPoll.resolve([]);
    await stopping;
  }
});

test('poller stops at a failed update and never executes a later callback twice', async () => {
  const offsets: number[] = [];
  const waits: number[] = [];
  const failedUpdateStarted = deferred<void>();
  const nextPollStarted = deferred<void>();
  const nextPoll = deferred<TelegramUpdate[]>();
  const started: number[] = [];
  let pollCount = 0;

  const client = {
    async deleteWebhook() {},
    async getUpdates(offset: number) {
      offsets.push(offset);
      if (pollCount++ === 0) return [update(20), update(21), update(22)];
      nextPollStarted.resolve();
      return nextPoll.promise;
    },
  } as unknown as TelegramClient;
  const handler = {
    async execute(value: { update_id: number }) {
      started.push(value.update_id);
      if (value.update_id === 21) {
        failedUpdateStarted.resolve();
        throw new Error('temporary handler failure');
      }
    },
  } as unknown as HandleTelegramWebhook;
  const poller = new TelegramPoller({
    client,
    handler,
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
    },
  });

  await poller.start();
  try {
    await failedUpdateStarted.promise;
    await nextPollStarted.promise;
    assert.deepEqual(offsets, [0, 21], 'update 22 cannot be acked past failed update 21');
    assert.deepEqual(started, [20, 21], 'later callback/update 22 is not executed before retry');
    assert.deepEqual(waits, [2_000], 'a failed update is retried with backoff, not in a hot loop');
  } finally {
    const stopping = poller.stop();
    nextPoll.resolve([]);
    await stopping;
  }
});

test('ordinary updates are handled in order, not concurrently', async () => {
  const firstGate = deferred<void>();
  const firstStarted = deferred<void>();
  const secondStarted = deferred<void>();
  const nextPoll = deferred<TelegramUpdate[]>();
  let pollCount = 0;
  const client = {
    async deleteWebhook() {},
    async getUpdates() {
      if (pollCount++ === 0) return [update(30), update(31)];
      return nextPoll.promise;
    },
  } as unknown as TelegramClient;
  const handler = {
    async execute(value: { update_id: number }) {
      if (value.update_id === 30) {
        firstStarted.resolve();
        await firstGate.promise;
      } else {
        secondStarted.resolve();
      }
    },
  } as unknown as HandleTelegramWebhook;
  const poller = new TelegramPoller({ client, handler, sleep: async () => {} });

  await poller.start();
  try {
    await firstStarted.promise;
    let secondHasStarted = false;
    void secondStarted.promise.then(() => {
      secondHasStarted = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(secondHasStarted, false);
    firstGate.resolve();
    await secondStarted.promise;
  } finally {
    firstGate.resolve();
    const stopping = poller.stop();
    nextPoll.resolve([]);
    await stopping;
  }
});
