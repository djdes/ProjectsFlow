import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchWithDeadline } from './fetchWithDeadline';

test('deadline aborts a connection that never receives headers', async (t) => {
  let aborted = false;
  t.mock.method(globalThis, 'fetch', (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
  }));
  await assert.rejects(fetchWithDeadline('/api/auth/me', {}, 15), /не ответил вовремя/);
  assert.equal(aborted, true);
});

test('deadline also bounds a stalled body and never retries a write', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    calls += 1;
    return { text: () => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new Error('aborted')));
    }) };
  });
  await assert.rejects(fetchWithDeadline('/api/task', { method: 'POST' }, 15), /не ответил вовремя/);
  assert.equal(calls, 1);
});

test('successful requests retain credentials, method and body', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    assert.equal(init.credentials, 'include');
    assert.equal(init.method, 'POST');
    assert.equal(init.body, '{}');
    return new Response('{"ok":true}', { status: 201 });
  });
  const result = await fetchWithDeadline('/api/task', { method: 'POST', credentials: 'include', body: '{}' }, 1000);
  assert.equal(result.response.status, 201);
  assert.equal(result.text, '{"ok":true}');
});
