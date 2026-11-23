import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import assert from 'node:assert/strict';
import { test } from 'node:test';

// Cache Storage stand-in (the device copy of earlier answers) and the account it belongs to,
// set up before the client module reads them.
const store = new Map<string, Response>();
(globalThis as unknown as { caches: unknown }).caches = {
  async open() {
    return {
      async put(key: string, response: Response) {
        store.set(String(key), response.clone());
      },
      async match(key: string) {
        return store.get(String(key))?.clone();
      },
    };
  },
  async delete() {
    store.clear();
    return true;
  },
};
localStorage.setItem('pf-offline-owner', 'u1');

const { httpClient, setRequestWorkspace } = await import('./httpClient');
const { offlineKey } = await import('./offlineReads');
const { READ_REFRESHED_EVENT } = await import('@/lib/readRefreshed');

setRequestWorkspace('ws');

function serve(t: import('node:test').TestContext, bodies: Record<string, unknown>, delayMs = 0): string[] {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(url);
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const path = url.replace(/^\/api/, '');
    return new Response(JSON.stringify(bodies[path] ?? {}), { headers: { 'Content-Type': 'application/json' } });
  });
  return calls;
}

function refreshed(withinMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (value: boolean): void => {
      window.removeEventListener(READ_REFRESHED_EVENT, onEvent);
      resolve(value);
    };
    const onEvent = (): void => done(true);
    window.addEventListener(READ_REFRESHED_EVENT, onEvent);
    setTimeout(() => done(false), withinMs);
  });
}

test('a kept answer is shown at once, refreshed in the background, and readers are told only when it changed', async (t) => {
  const realNow = Date.now;
  let offset = 0;
  t.mock.method(Date, 'now', () => realNow() + offset);
  const path = '/projects/pa/members';
  serve(t, { [path]: { members: ['a'] } });
  assert.deepEqual(await httpClient.get(path), { members: ['a'] });

  offset += 61_000; // past the fresh window
  t.mock.restoreAll();
  t.mock.method(Date, 'now', () => realNow() + offset);
  const calls = serve(t, { [path]: { members: ['a', 'b'] } });
  const told = refreshed();
  assert.deepEqual(await httpClient.get(path, { swr: true }), { members: ['a'] }, 'the kept answer, without waiting');
  assert.equal(await told, true, 'the fresh answer differs: readers re-read');
  assert.equal(calls.length, 1, 'one background request');
  assert.deepEqual(await httpClient.get(path), { members: ['a', 'b'] }, 'now fresh in memory');
  assert.equal(calls.length, 1, 'no request for the re-read');

  offset += 61_000;
  const unchanged = refreshed(200);
  assert.deepEqual(await httpClient.get(path, { swr: true }), { members: ['a', 'b'] });
  assert.equal(await unchanged, false, 'nothing changed: nobody re-reads');
});

test('a reader that does not follow refreshes never gets an expired answer', async (t) => {
  const realNow = Date.now;
  let offset = 0;
  t.mock.method(Date, 'now', () => realNow() + offset);
  const path = '/projects/pb/members';
  serve(t, { [path]: { members: ['old'] } });
  await httpClient.get(path);
  offset += 61_000;
  t.mock.restoreAll();
  t.mock.method(Date, 'now', () => realNow() + offset);
  const calls = serve(t, { [path]: { members: ['new'] } });
  assert.deepEqual(await httpClient.get(path), { members: ['new'] });
  assert.equal(calls.length, 1);
});

test('on a cold start the copy saved on the device is shown first, then the network answer replaces it', async (t) => {
  const path = '/inbox';
  store.set(
    offlineKey('u1', 'ws', path),
    new Response(JSON.stringify({ project: { id: 'inbox', name: 'Saved' } }), {
      headers: { 'Content-Type': 'application/json', 'X-Pf-Saved-At': String(Date.now() - 60_000) },
    }),
  );
  serve(t, { [path]: { project: { id: 'inbox', name: 'Fresh' } } }, 60);
  const told = refreshed(1000);
  assert.deepEqual(await httpClient.get(path, { swr: true }), { project: { id: 'inbox', name: 'Saved' } });
  assert.equal(await told, true, 'the network answer differs: readers re-read');
  assert.deepEqual(await httpClient.get(path), { project: { id: 'inbox', name: 'Fresh' } });
});

test('a copy saved before save times were kept is ignored', async (t) => {
  const path = '/projects';
  store.set(offlineKey('u1', 'ws', path), new Response(JSON.stringify({ projects: ['ancient'] })));
  serve(t, { [path]: { projects: ['fresh'] } }, 20);
  assert.deepEqual(await httpClient.get(path, { swr: true }), { projects: ['fresh'] });
});

test('a combined answer fills its parts; peek shows what is known without a request', async (t) => {
  serve(t, { '/assignees/overview': { mine: { items: [1] }, awaitingReply: { items: [2] } } });
  assert.equal(httpClient.peek('/assignees/overview'), undefined);
  await httpClient.get('/assignees/overview', { swr: true, parts: { mine: '/assignees/mine', awaitingReply: '/assignees/awaiting-reply' } });
  assert.deepEqual(httpClient.peek('/assignees/overview'), { mine: { items: [1] }, awaitingReply: { items: [2] } });
  t.mock.restoreAll();
  const calls = serve(t, {});
  assert.deepEqual(await httpClient.get('/assignees/awaiting-reply'), { items: [2] }, 'the badge reads its part from memory');
  assert.deepEqual(await httpClient.get('/assignees/mine'), { items: [1] });
  assert.equal(calls.length, 0);
  assert.equal(httpClient.peek('/projects/pz/tasks/t1'), undefined, 'uncached paths have nothing to peek');
});

test('a read started ahead is handed to the next reader once; an own write discards it', async (t) => {
  const path = '/projects/pp/tasks/t1/comments';
  let calls = serve(t, { [path]: { comments: ['first'] } });
  httpClient.prefetch(path);
  assert.deepEqual(await httpClient.get(path), { comments: ['first'] }, 'the window section takes the answer fetched ahead');
  assert.equal(calls.length, 1, 'no second request');
  await httpClient.get(path);
  assert.equal(calls.length, 2, 'taken once: the next read asks again');

  t.mock.restoreAll();
  serve(t, { [path]: { comments: ['old'] }, '/projects/pp/tasks/t1': {} });
  httpClient.prefetch(path);
  await new Promise((resolve) => setTimeout(resolve, 10));
  await httpClient.patch('/projects/pp/tasks/t1', {});
  t.mock.restoreAll();
  calls = serve(t, { [path]: { comments: ['after the write'] } });
  assert.deepEqual(await httpClient.get(path), { comments: ['after the write'] }, 'fetched before an own write: not handed out');
  assert.equal(calls.length, 1);
});
