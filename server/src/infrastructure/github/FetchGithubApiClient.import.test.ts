import assert from 'node:assert/strict';
import test from 'node:test';
import { GithubApiError } from '../../domain/github/errors.js';
import { FetchGithubApiClient } from './FetchGithubApiClient.js';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('FetchGithubApiClient безопасно инициализирует пустой repo перед Git Database import', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: any }> = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url, method, body });
    if (url.endsWith('/git/ref/heads/main')) return json({ message: 'empty' }, 409);
    if (url.endsWith('/contents/.projectsflow-import-init') && method === 'PUT') {
      return json({ commit: { sha: 'root-sha' } });
    }
    if (url.endsWith('/git/commits/root-sha')) return json({ parents: [] });
    if (url.endsWith('/git/blobs')) return json({ sha: 'blob-sha' });
    if (url.endsWith('/git/trees')) return json({ sha: 'tree-sha' });
    if (url.endsWith('/git/commits')) return json({ sha: 'import-sha' });
    if (url.endsWith('/git/refs/heads/main') && method === 'PATCH') return json({ ref: 'heads/main' });
    return json({ message: 'unexpected request' }, 500);
  };
  try {
    await new FetchGithubApiClient(null).importRepoFiles(
      'token',
      'yaroslav/magflow_v2',
      'main',
      [{ path: 'package.json', contentBase64: 'e30=' }],
      'import',
      { requireEmpty: true },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  const initialize = calls.find((call) => call.url.endsWith('/contents/.projectsflow-import-init'));
  assert.equal(initialize?.method, 'PUT');
  assert.equal(initialize?.body.branch, undefined, 'empty repo must initialize its default branch');
  const patch = calls.at(-1)!;
  assert.equal(patch.method, 'PATCH');
  assert.deepEqual(patch.body, { sha: 'import-sha', force: false });
});

test('FetchGithubApiClient не начинает import, если у выбранного repo уже появился HEAD', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return json({ object: { sha: 'existing-sha' } });
  };
  try {
    await assert.rejects(
      () => new FetchGithubApiClient(null).importRepoFiles(
        'token',
        'yaroslav/magflow_v2',
        'main',
        [{ path: 'package.json', contentBase64: 'e30=' }],
        'import',
        { requireEmpty: true },
      ),
      (error: unknown) => error instanceof GithubApiError && error.status === 409,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls.length, 1);
});
