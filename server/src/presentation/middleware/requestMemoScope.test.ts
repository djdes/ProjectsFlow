import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import express from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { RequestMemo } from '../../infrastructure/request/RequestMemo.js';
import { requestMemoScope } from './requestMemoScope.js';

async function harness(t: TestContext) {
  const memo = new RequestMemo();
  let reads = 0;
  const check = () =>
    memo.memoize('access', async () => {
      reads += 1;
      return true;
    });
  let afterResponse: Promise<void> = Promise.resolve();

  const app = express();
  app.use(requestMemoScope({ run: (active, next) => memo.run(active, next) }));
  const answerAfterChecks = async (_req: express.Request, res: express.Response) => {
    for (let i = 0; i < 3; i += 1) await check();
    res.json({ ok: true });
  };
  app.get('/list', answerAfterChecks);
  app.post('/list', answerAfterChecks);
  // An event stream sends its headers first and then checks access per event.
  app.get('/stream', async (_req, res) => {
    await check();
    await check();
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    await check();
    await check();
    res.end('data: done\n\n');
  });
  // Follow-up work started inside the request (so it runs in the request's scope) that goes on
  // after the response has been sent.
  app.get('/follow-up', async (_req, res) => {
    await check();
    afterResponse = (async () => {
      await new Promise((resolve) => res.once('finish', resolve));
      await check();
      await check();
    })();
    res.json({ ok: true });
  });

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    request: async (path: string, method = 'GET') => {
      const res = await fetch(base + path, { method, signal: AbortSignal.timeout(5000) });
      await res.text();
      return res.status;
    },
    reads: () => reads,
    afterResponse: () => afterResponse,
  };
}

test('GET: repeated lookups of one request read once; the next request reads again', async (t) => {
  const h = await harness(t);
  assert.equal(await h.request('/list'), 200);
  assert.equal(h.reads(), 1);
  assert.equal(await h.request('/list'), 200);
  assert.equal(h.reads(), 2);
});

test('writes are not memoized: a write may change the permission it has just read', async (t) => {
  const h = await harness(t);
  assert.equal(await h.request('/list', 'POST'), 200);
  assert.equal(h.reads(), 3);
});

test('a stream reads access afresh once its headers are sent', async (t) => {
  const h = await harness(t);
  assert.equal(await h.request('/stream'), 200);
  // One read before the headers, then one per check.
  assert.equal(h.reads(), 3);
});

test('work that outlives the response reads afresh', async (t) => {
  const h = await harness(t);
  assert.equal(await h.request('/follow-up'), 200);
  await h.afterResponse();
  assert.equal(h.reads(), 3);
});
