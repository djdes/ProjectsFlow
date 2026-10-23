import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { deploymentRouter } from './routes.js';

test('platform update status requires a session and never accepts a caller-selected repository', async (t) => {
  let reads = 0;
  const app = express();
  app.use((req, _res, next) => { if (req.get('test-session') === 'valid') req.user = { id: 'member' } as never; next(); });
  app.use('/status', deploymentRouter({ execute: async () => { reads++; return { phase: 'queued', stale: false } as never; } }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/status`;
  assert.equal((await fetch(url)).status, 401); assert.equal(reads, 0);
  const response = await fetch(url + '?repository=private-other', { headers: { 'test-session': 'valid' } });
  assert.equal(response.status, 200); assert.equal(reads, 1);
  assert.match(response.headers.get('cache-control') ?? '', /private, no-store/);
  assert.deepEqual(await response.json(), { phase: 'queued', stale: false });
});
