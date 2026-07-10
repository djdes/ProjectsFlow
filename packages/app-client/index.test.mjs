import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, AppClientError } from './index.js';

// Фейковый fetch: записывает вызовы и отдаёт заранее заготовленные ответы.
function fakeFetch(script) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const next = script.shift();
    if (!next) throw new Error(`нет заготовленного ответа для ${url}`);
    return {
      ok: next.status < 400,
      status: next.status,
      text: async () => (next.body === undefined ? '' : JSON.stringify(next.body)),
    };
  };
  fn.calls = calls;
  return fn;
}

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
}

test('signIn сохраняет токен и шлёт его в последующих запросах', async () => {
  const fetch = fakeFetch([
    { status: 200, body: { user: { id: 'u1', email: 'a@x' }, token: 'tok-123' } },
    { status: 200, body: [] },
  ]);
  const pf = createClient('', '', { fetch, storage: memStorage() });
  const user = await pf.auth.signIn('a@x', 'pw');
  assert.deepEqual(user, { id: 'u1', email: 'a@x' });

  await pf.from('posts').select();
  const dataCall = fetch.calls[1];
  assert.equal(dataCall.url, '/api/data/posts');
  assert.equal(dataCall.init.headers['Authorization'], 'Bearer tok-123');
});

test('select строит query из filter/sort/dir/limit', async () => {
  const fetch = fakeFetch([{ status: 200, body: [] }]);
  const pf = createClient('https://slug.projectsflow.ru/', 'app-key-1', { fetch, storage: memStorage() });
  await pf.from('posts').select({ filter: { owner_id: 'u1' }, sort: 'created_at', dir: 'desc', limit: 5 });
  const { url, init } = fetch.calls[0];
  assert.ok(url.startsWith('https://slug.projectsflow.ru/api/data/posts?'));
  assert.ok(url.includes('owner_id=u1'));
  assert.ok(url.includes('sort=created_at'));
  assert.ok(url.includes('dir=desc'));
  assert.ok(url.includes('limit=5'));
  assert.equal(init.headers['X-App-Key'], 'app-key-1'); // appKey прокидывается
});

test('insert шлёт POST с JSON-телом и Content-Type', async () => {
  const fetch = fakeFetch([{ status: 201, body: { id: 'p1', title: 'x' } }]);
  const pf = createClient('', '', { fetch, storage: memStorage() });
  const row = await pf.from('posts').insert({ title: 'x' });
  assert.deepEqual(row, { id: 'p1', title: 'x' });
  const { init } = fetch.calls[0];
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.body, JSON.stringify({ title: 'x' }));
});

test('ошибка → AppClientError со статусом и кодом', async () => {
  const fetch = fakeFetch([{ status: 409, body: { error: 'user_exists' } }]);
  const pf = createClient('', '', { fetch, storage: memStorage() });
  await assert.rejects(
    () => pf.auth.signUp('a@x', 'pw'),
    (e) => e instanceof AppClientError && e.status === 409 && e.code === 'user_exists',
  );
});

test('user() без токена не делает запрос и возвращает null', async () => {
  const fetch = fakeFetch([]);
  const pf = createClient('', '', { fetch, storage: memStorage() });
  assert.equal(await pf.auth.user(), null);
  assert.equal(fetch.calls.length, 0);
});
