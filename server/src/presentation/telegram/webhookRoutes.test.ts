import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import type { HandleTelegramWebhook } from '../../application/telegram/HandleTelegramWebhook.js';
import { telegramWebhookRouter } from './webhookRoutes.js';

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function listen(
  handler: Pick<HandleTelegramWebhook, 'execute'>,
  secretToken: string | null = null,
): Promise<{ server: Server; url: string }> {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/telegram/webhook',
    telegramWebhookRouter({ handler: handler as HandleTelegramWebhook, secretToken }),
  );
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, url: `http://127.0.0.1:${port}/api/telegram/webhook` };
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test('webhook sends its 200 acknowledgement only after handler completion', async () => {
  const handlerStarted = deferred<void>();
  const releaseHandler = deferred<void>();
  let receivedUpdateId: number | null = null;
  const handler = {
    async execute(update: { update_id: number }) {
      receivedUpdateId = update.update_id;
      handlerStarted.resolve();
      await releaseHandler.promise;
    },
  } as unknown as HandleTelegramWebhook;
  const { server, url } = await listen(handler);

  try {
    let responseSettled = false;
    const responsePromise = fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ update_id: 77 }),
    }).then((response) => {
      responseSettled = true;
      return response;
    });

    await handlerStarted.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(receivedUpdateId, 77);
    assert.equal(responseSettled, false, 'request must remain open while the handler is running');

    releaseHandler.resolve();
    const response = await responsePromise;
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    releaseHandler.resolve();
    await close(server);
  }
});

test('webhook returns 503 on handler failure so Telegram retries an unpersisted update', async () => {
  let calls = 0;
  const handler = {
    async execute() {
      calls += 1;
      throw new Error('poison update');
    },
  } as unknown as HandleTelegramWebhook;
  const { server, url } = await listen(handler);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ update_id: 78 }),
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false });
    assert.equal(calls, 1);
  } finally {
    await close(server);
  }
});

test('webhook rejects a wrong secret with 200 without invoking the handler', async () => {
  let calls = 0;
  const handler = {
    async execute() {
      calls += 1;
    },
  } as unknown as HandleTelegramWebhook;
  const { server, url } = await listen(handler, 'expected-secret');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret',
      },
      body: JSON.stringify({ update_id: 79 }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: false });
    assert.equal(calls, 0);
  } finally {
    await close(server);
  }
});
