import assert from 'node:assert/strict';
import { test } from 'node:test';
import { httpClient, setRequestWorkspace, workspaceHttpClient } from './httpClient';
import { HttpTaskAssigneeRepository } from './HttpTaskAssigneeRepository';
import { HttpStatsRepository } from './HttpStatsRepository';
import { HttpRecentTaskViewRepository } from './HttpRecentTaskViewRepository';

test('parallel workspace boards bind every read and mutation without changing the selected workspace', async (t) => {
  const requests: { scope: string | null; method: string; path: string }[] = [];
  t.mock.method(globalThis, 'fetch', async (path: string, options: RequestInit) => {
    const scope = new Headers(options.headers).get('X-Workspace-Id');
    requests.push({ scope, method: options.method ?? 'GET', path });
    await new Promise((resolve) => setTimeout(resolve, scope === 'a' ? 5 : 1));
    return options.method === 'GET' ? new Response(JSON.stringify({ scope, items: [], taskIds: [], count: 0 })) : new Response(null, { status: 204 });
  });
  setRequestWorkspace('selected'); t.after(() => setRequestWorkspace(null));
  const a = workspaceHttpClient('a'); const b = workspaceHttpClient('b');
  const result = await Promise.all([a.get<{ scope: string }>('/same'), b.get<{ scope: string }>('/same')]);
  assert.deepEqual(result.map((item) => item.scope), ['a', 'b']);
  await Promise.all([a.post('/create', {}), b.patch('/edit', {}), a.put('/move', {}), b.delete('/remove')]);
  assert.deepEqual(requests.slice(2).map((request) => [request.method, request.scope]), [['POST', 'a'], ['PATCH', 'b'], ['PUT', 'a'], ['DELETE', 'b']]);
  await httpClient.get('/selected'); assert.equal(requests.at(-1)!.scope, 'selected');
  await new HttpTaskAssigneeRepository(a).listMine();
  await new HttpStatsRepository(b).unreadTaskIds();
  assert.equal(requests.at(-2)!.scope, 'a'); assert.equal(requests.at(-1)!.scope, 'b');
  await new HttpRecentTaskViewRepository(b).record('task-in-b');
  assert.equal(requests.at(-1)!.scope, 'b');
});
