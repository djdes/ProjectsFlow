import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { liveUserRouter } from './routes.js';
import { LiveEventHub } from '../../infrastructure/realtime/LiveEventHub.js';

test('SSE for an attempt receives only that attempt, even when another run of the same task is active', { timeout: 5000 }, async () => {
  const hub = new LiveEventHub();
  const app = express();
  app.use((req, _res, next) => { req.user = { id: 'member' } as NonNullable<typeof req.user>; next(); });
  const service = {
    async getSessionForStream() { return { id: 'attempt-1', status: 'running', endedAt: null }; },
    async listEvents() { return []; },
  };
  app.use('/api/projects', liveUserRouter({ service: service as never, liveEventHub: hub }));
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const controller = new AbortController();
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/p/tasks/t/live/sessions/attempt-1/stream`, { signal: controller.signal });
    const reader = response.body!.getReader();
    const initial = await reader.read();
    let text = new TextDecoder().decode(initial.value);
    hub.publish('attempt-2', [{ seq: 2, kind: 'assistant_text', text: 'Чужая попытка', createdAt: new Date() }]);
    hub.publishEnd('attempt-2', 'failed');
    hub.publish('attempt-1', [{ seq: 1, kind: 'assistant_text', text: 'Своя попытка', createdAt: new Date() }]);
    hub.publishEnd('attempt-1', 'completed');
    while (!text.includes('live_end')) text += new TextDecoder().decode((await reader.read()).value);
    assert.ok(text.includes('Своя попытка'));
    assert.ok(text.includes('completed'));
    assert.ok(!text.includes('Чужая попытка'));
    assert.ok(!text.includes('failed'));
    await reader.cancel();
  } finally {
    controller.abort();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
