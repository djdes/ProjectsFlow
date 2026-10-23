import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FetchGithubApiClient } from './FetchGithubApiClient.js';

test('getCommit reads every file page from the fixed GitHub origin and refuses a changed commit', async () => {
  const original = globalThis.fetch;
  const requests: string[] = [];
  let mismatch = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input); requests.push(url);
    assert.equal(new URL(url).origin, 'https://api.github.com');
    assert.ok(init?.signal);
    const second = url.includes('page=2');
    return new Response(JSON.stringify({ sha: second && mismatch ? 'different' : 'abc',
      commit: { message: 'fix [12345678]', author: { name: 'Worker', date: '2026-10-23T13:00:00Z' } }, author: null, html_url: 'https://github.com/o/r/commit/abc',
      files: [{ filename: second ? 'second.ts' : 'first.ts', status: 'modified', additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-a\n+b' }],
    }), { headers: second ? {} : { link: '<https://untrusted.example/credentials>; rel="next"' } });
  };
  try {
    const api = new FetchGithubApiClient(null);
    const result = await api.getCommit('test-token', { owner: 'o', repo: 'r', sha: 'abc' });
    assert.deepEqual(result.files?.map(file => file.path), ['first.ts', 'second.ts']);
    assert.equal(result.changedFiles, 2);
    assert.equal(requests.length, 2);
    mismatch = true;
    await assert.rejects(api.getCommit('test-token', { owner: 'o', repo: 'r', sha: 'abc' }), /page mismatch/);
  } finally { globalThis.fetch = original; }
});
