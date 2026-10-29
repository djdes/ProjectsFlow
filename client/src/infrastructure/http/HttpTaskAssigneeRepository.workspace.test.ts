import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpTaskAssigneeRepository } from './HttpTaskAssigneeRepository';
import { setRequestWorkspace } from './httpClient';
import { HttpError } from '@/lib/HttpError';

test('cross-workspace reads carry explicit scope and never change the selected workspace', async (t) => {
  const requests: { path: string; scope: string | null; method: string }[] = [];
  t.mock.method(globalThis, 'fetch', async (path: string, options: RequestInit) => {
    requests.push({ path, scope: new Headers(options.headers).get('X-Workspace-Id'), method: options.method ?? 'GET' });
    return new Response(JSON.stringify({ items: [] }), { headers: { 'Content-Type': 'application/json' } });
  });
  setRequestWorkspace('selected');
  t.after(() => setRequestWorkspace(null));
  const repo = new HttpTaskAssigneeRepository();
  await Promise.all([repo.listMineInWorkspace('a'), repo.listOthersInWorkspace('a'), repo.listOthersInWorkspace('b')]);
  await repo.listOthers();
  assert.deepEqual(requests.map((request) => [request.path, request.scope]), [
    ['/api/assignees/mine', 'a'], ['/api/assignees/others', 'a'], ['/api/assignees/others', 'b'], ['/api/assignees/others', 'selected'],
  ]);
  assert.ok(requests.every((request) => request.method === 'GET'));
});

test('denied workspace reads propagate failure instead of returning an empty or stale task list', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'workspace_not_found' }), { status: 404 }));
  const repo = new HttpTaskAssigneeRepository();
  await assert.rejects(() => repo.listOthersInWorkspace('private'), (error: unknown) => error instanceof HttpError && error.status === 404);
});
