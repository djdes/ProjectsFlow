import assert from 'node:assert/strict';
import { test } from 'node:test';
import { httpClient, setRequestWorkspace } from './httpClient';

test('stable reads come from memory until a write; volatile reads always go to the network', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (path: string, options: RequestInit) => {
    const method = options.method ?? 'GET';
    calls.push(`${method} ${path}`);
    return method === 'GET'
      ? new Response(JSON.stringify({ members: [{ id: 'a' }], tasks: [] }))
      : new Response(null, { status: 204 });
  });
  const count = (line: string): number => calls.filter((call) => call === line).length;

  const first = await httpClient.get<{ members: Array<{ id: string }> }>('/projects/p9/members');
  first.members.push({ id: 'a caller edits its copy' });
  const second = await httpClient.get<{ members: Array<{ id: string }> }>('/projects/p9/members');
  assert.equal(count('GET /api/projects/p9/members'), 1, 'the second read is served from memory');
  assert.deepEqual(second.members, [{ id: 'a' }], 'an edited copy does not leak into the cache');

  await httpClient.get('/projects/p9/tasks/t1');
  await httpClient.get('/projects/p9/tasks/t1');
  assert.equal(count('GET /api/projects/p9/tasks/t1'), 2, 'a task itself is always read fresh');

  await httpClient.post('/recent-task-views', { taskId: 't1' });
  await httpClient.get('/projects/p9/members');
  assert.equal(count('GET /api/projects/p9/members'), 1, 'recording a task view keeps the cache');

  await httpClient.post('/projects/p9/members', { email: 'new@example.com' });
  await httpClient.get('/projects/p9/members');
  assert.equal(count('GET /api/projects/p9/members'), 2, 'a write makes the next read go to the server');

  setRequestWorkspace('other');
  t.after(() => setRequestWorkspace(null));
  await httpClient.get('/projects/p9/members');
  assert.equal(count('GET /api/projects/p9/members'), 3, 'another workspace has its own entries');
});
