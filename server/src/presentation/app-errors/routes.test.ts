import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { appErrorIngestRouter, appErrorAgentRouter } from './routes.js';
import { AppErrorReports, type AppErrorReport, type AppErrorSearch } from '../../application/app-errors/AppErrorReports.js';
import type { AuthenticateAgentToken } from '../../application/agent/AuthenticateAgentToken.js';

const KEY = 'pfae_test_key';

async function withApi(run: (base: string, stored: AppErrorReport[], searches: AppErrorSearch[]) => Promise<void>) {
  const stored: AppErrorReport[] = [];
  const searches: AppErrorSearch[] = [];
  let n = 0;
  const service = new AppErrorReports({
    keySha256: createHash('sha256').update(KEY).digest('hex'),
    idGen: () => `id-${++n}`,
    now: () => new Date('2026-11-19T20:00:00Z'),
    repo: {
      async insert(r) { if (stored.some((s) => s.reportId === r.reportId)) return false; stored.push({ ...r, receivedAt: new Date() }); return true; },
      async search(q) { searches.push(q); return stored; },
      async purgeOlderThan() {},
    },
  });
  const authenticate = { async execute(token: string) { return { user: { id: 'u', isAdmin: token === 'admin' }, token: { id: 't', scopeKind: 'account' } }; } } as unknown as AuthenticateAgentToken;
  const app = express();
  app.use('/api/app-errors', appErrorIngestRouter(service));
  app.use('/api/agent/app-errors', appErrorAgentRouter(service, authenticate));
  app.use(express.json({ limit: '256kb' }));
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, stored, searches); }
  finally { await new Promise<void>((r) => server.close(() => r())); }
}

const post = (base: string, body: unknown, key = KEY) => fetch(base + '/api/app-errors', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-App-Error-Key': key }, body: JSON.stringify(body),
});
const report = { reportId: 'aaaaaaaa-1111', program: 'Config', version: '1.2', machine: 'OFFICE', user: 'irina', level: 'error', caption: 'Генерация фото не удалась', details: 'HttpRequestException', occurredAt: '2026-11-19T19:20:00Z' };

test('ingest: key required, body validated, retries deduplicated, big log tail trimmed', async () => {
  await withApi(async (base, stored) => {
    assert.equal((await post(base, report, 'wrong')).status, 401);
    assert.equal((await post(base, { program: 'x' })).status, 400);
    const bigLog = 'a'.repeat(300 * 1024) + 'END';
    assert.equal((await post(base, { ...report, log: bigLog })).status, 202);
    assert.equal((await post(base, report)).status, 202);
    assert.equal(stored.length, 1);
    assert.equal(stored[0]!.logTail!.length, 256 * 1024);
    assert.ok(stored[0]!.logTail!.endsWith('END'));
    assert.equal(stored[0]!.occurredAt.toISOString(), '2026-11-19T19:20:00.000Z');
    const future = await post(base, { ...report, reportId: 'bbbbbbbb-2222', occurredAt: '2030-01-01T00:00:00Z' });
    assert.equal(future.status, 202);
    assert.equal(stored[1]!.occurredAt.toISOString(), '2026-11-19T20:00:00.000Z');
  });
});

test('agent search: admin only, log only on request', async () => {
  await withApi(async (base, _stored, searches) => {
    await post(base, { ...report, log: 'tail' });
    assert.equal((await fetch(base + '/api/agent/app-errors', { headers: { Authorization: 'Bearer user' } })).status, 403);
    const r = await fetch(base + '/api/agent/app-errors?program=Config&query=%D1%84%D0%BE%D1%82%D0%BE&hours=24', { headers: { Authorization: 'Bearer admin' } });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.items[0].caption, 'Генерация фото не удалась');
    assert.equal('log' in body.items[0], false);
    assert.deepEqual(searches[0], { program: 'Config', query: 'фото', hours: 24, limit: 20, withLog: false });
    const withLog = await (await fetch(base + '/api/agent/app-errors?withLog=true', { headers: { Authorization: 'Bearer admin' } })).json();
    assert.equal(withLog.items[0].log, 'tail');
  });
});
