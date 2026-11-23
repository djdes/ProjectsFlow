import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadCache, readCachePolicy, readCacheTtl } from './ReadCache';

/** An entry fresh for `fresh` ms and kept (shown while refreshing) ten times as long. */
function put(cache: ReadCache, key: string, path: string, value: unknown, fresh: number): void {
  cache.store(key, path, value, { fresh, keep: fresh * 10 });
}

function clock(): { now: () => number; advance: (ms: number) => void } {
  let t = 1_000;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('only slowly changing resources are cached', () => {
  for (const path of ['/projects', '/projects/p1', '/projects/p1/members', '/projects/p1/kanban-settings', '/projects/p1/site', '/workspaces', '/workspaces/w1/members', '/me/ui-prefs', '/integrations/github/me', '/inbox']) {
    assert.notEqual(readCacheTtl(path), null, `${path} should be cached`);
  }
  for (const path of ['/projects/p1/tasks', '/assignees/mine', '/assignees/approvals']) {
    assert.ok((readCacheTtl(path) ?? Infinity) <= 15_000, `${path}: a list is kept only briefly`);
  }
  for (const path of ['/projects/p1/tasks/t1', '/projects/p1/tasks/t1/comments', '/me/unread-tasks', '/notifications/unread-count', '/projects/p1/live/activity', '/auth/me', '/platform/deployment', '/projects?archived=1']) {
    assert.equal(readCacheTtl(path), null, `${path} must always be read fresh`);
  }
  // People pickers always re-read; the inbox people ribbon still shows the known list at once.
  assert.equal(readCacheTtl('/me/shared-members'), 0);
  assert.ok((readCachePolicy('/me/shared-members')?.keep ?? 0) > 0);
});

test('fresh, then kept (shown while refreshing), then gone — and every reader gets its own copy', () => {
  const c = clock();
  const cache = new ReadCache(c.now);
  cache.store('w:/projects/p1/members', '/projects/p1/members', { members: [{ id: 'a' }] }, { fresh: 1000, keep: 5000 }, '{"members":[{"id":"a"}]}');
  const first = cache.get('w:/projects/p1/members') as { members: Array<{ id: string }> };
  first.members.push({ id: 'mutated by a caller' });
  assert.deepEqual(cache.get('w:/projects/p1/members'), { members: [{ id: 'a' }] });
  c.advance(1001);
  assert.equal(cache.get('w:/projects/p1/members'), undefined, 'past fresh: strict readers go to the network');
  const kept = cache.lookup('w:/projects/p1/members');
  assert.equal(kept?.stale, true);
  assert.deepEqual(kept?.value, { members: [{ id: 'a' }] });
  assert.equal(kept?.text, '{"members":[{"id":"a"}]}', 'the body is kept to tell whether a new one differs');
  assert.deepEqual(cache.peek('w:/projects/p1/members'), { members: [{ id: 'a' }] }, 'a first render may show it');
  c.advance(4000);
  assert.equal(cache.lookup('w:/projects/p1/members'), undefined, 'past keep: gone');
  assert.equal(cache.peek('w:/projects/p1/members'), undefined);
});

test('an answer saved long ago is stored as already stale, and one past keep is not stored', () => {
  const c = clock();
  const cache = new ReadCache(c.now);
  cache.store('w:/inbox', '/inbox', 1, { fresh: 1000, keep: 5000 }, null, c.now() - 2000);
  assert.equal(cache.lookup('w:/inbox')?.stale, true);
  cache.store('w:/projects', '/projects', 2, { fresh: 1000, keep: 5000 }, null, c.now() - 6000);
  assert.equal(cache.lookup('w:/projects'), undefined);
});

test('lists are fresh only briefly but kept long enough to show on the next visit', () => {
  for (const path of ['/assignees/overview', '/assignees/mine', '/projects/p1/tasks']) {
    const policy = readCachePolicy(path);
    assert.ok(policy && policy.fresh <= 15_000 && policy.keep >= 60 * 60_000, path);
  }
});

test('an own write drops what it may have changed and keeps the rest', () => {
  const c = clock();
  const cache = new ReadCache(c.now);
  const fill = (): void => {
    // Answers asked for after the writes above (one asked in the same millisecond is not trusted).
    c.advance(1);
    put(cache, 'w:/projects', '/projects', 1, 60_000);
    put(cache, 'w:/projects/p1/members', '/projects/p1/members', 2, 60_000);
    put(cache, 'w:/projects/p1/views', '/projects/p1/views', 3, 60_000);
    put(cache, 'w:/me/ui-prefs', '/me/ui-prefs', 4, 60_000);
    put(cache, 'w:/inbox', '/inbox', 5, 60_000);
    put(cache, 'w:/projects/p2/tasks', '/projects/p2/tasks', 6, 15_000);
    put(cache, 'w:/assignees/overview', '/assignees/overview', 7, 15_000);
  };
  fill();
  cache.afterWrite('/recent-task-views');
  cache.afterWrite('/notifications/n1/read');
  cache.afterWrite('/push/subscriptions');
  assert.equal(cache.get('w:/projects'), 1, 'browsing writes change nothing cached');
  cache.afterWrite('/projects/p1/views');
  assert.equal(cache.peek('w:/projects/p1/views'), undefined, 'a board view write drops the views list');
  assert.equal(cache.get('w:/projects/p1/members'), 2);
  cache.afterWrite('/me/ui-prefs');
  assert.equal(cache.peek('w:/me/ui-prefs'), undefined);
  assert.equal(cache.get('w:/projects'), 1);
  fill();
  cache.afterWrite('/projects/p1/tasks/t1/move');
  for (const key of ['w:/projects', 'w:/projects/p2/tasks', 'w:/assignees/overview']) {
    assert.equal(cache.peek(key), undefined, `${key}: a task write may have changed it — never shown again`);
  }
  for (const key of ['w:/projects/p1/members', 'w:/projects/p1/views', 'w:/me/ui-prefs', 'w:/inbox']) {
    assert.notEqual(cache.get(key), undefined, `${key} does not depend on a task`);
  }
  cache.afterWrite('/projects/p1/members');
  for (const key of ['w:/projects/p1/members', 'w:/me/ui-prefs', 'w:/inbox']) {
    assert.equal(cache.peek(key), undefined, `${key}: an unknown write may change anything`);
  }
});

test('a change made elsewhere expires what it touched: not fresh, still shown while refreshing', () => {
  const target = new EventTarget();
  const cache = new ReadCache();
  cache.listen(target as unknown as Window);
  const fill = (): void => {
    put(cache, 'w:/projects', '/projects', 1, 60_000);
    put(cache, 'w:/projects/p1', '/projects/p1', 2, 60_000);
    put(cache, 'w:/projects/p1/members', '/projects/p1/members', 3, 60_000);
    put(cache, 'w:/projects/p1/site', '/projects/p1/site', 4, 60_000);
  };
  fill();
  target.dispatchEvent(new CustomEvent('pf:task-changed', { detail: { projectId: 'p1' } }));
  assert.equal(cache.get('w:/projects'), undefined, 'task counts in the project list: read again');
  assert.equal(cache.peek('w:/projects'), 1, 'but the screen keeps showing it until then');
  assert.equal(cache.get('w:/projects/p1'), undefined);
  assert.equal(cache.get('w:/projects/p1/members'), 3, 'members do not change with a task');
  target.dispatchEvent(new CustomEvent('pf:live-changed', { detail: { projectId: 'p1' } }));
  assert.equal(cache.get('w:/projects/p1/site'), undefined, 'a worker run may publish the site');
  for (const name of ['pf:project-changed', 'pf:realtime-connected', 'online']) {
    fill();
    target.dispatchEvent(new CustomEvent(name, { detail: { projectId: 'p1' } }));
    assert.equal(cache.get('w:/projects/p1/members'), undefined, `${name}: anything may have changed`);
    assert.equal(cache.peek('w:/projects/p1/members'), 3);
  }
  fill();
  target.dispatchEvent(new Event('pf:session-expired'));
  assert.equal(cache.peek('w:/projects'), undefined, 'an expired session drops everything');
});

test('a task changed anywhere expires the task lists at once', () => {
  const target = new EventTarget();
  const cache = new ReadCache();
  cache.listen(target as unknown as Window);
  const fill = (): void => {
    put(cache, 'w:/assignees/mine', '/assignees/mine', 1, 15_000);
    put(cache, 'w:/projects/p1/tasks', '/projects/p1/tasks', 2, 15_000);
    put(cache, 'w:/projects/p2/tasks', '/projects/p2/tasks', 3, 15_000);
    put(cache, 'w:/projects/p1/members', '/projects/p1/members', 4, 60_000);
  };
  fill();
  target.dispatchEvent(new CustomEvent('pf:task-changed', { detail: { projectId: 'p1' } }));
  assert.equal(cache.get('w:/assignees/mine'), undefined);
  assert.equal(cache.get('w:/projects/p1/tasks'), undefined);
  assert.equal(cache.peek('w:/projects/p1/tasks'), 2);
  assert.equal(cache.get('w:/projects/p2/tasks'), 3, 'another project keeps its list');
  assert.equal(cache.get('w:/projects/p1/members'), 4);
  fill();
  target.dispatchEvent(new Event('pf:task-changed'));
  assert.equal(cache.get('w:/projects/p2/tasks'), undefined, 'no project id: every list');
  fill();
  target.dispatchEvent(new CustomEvent('pf:live-changed', { detail: { projectId: 'p2' } }));
  assert.equal(cache.get('w:/projects/p2/tasks'), undefined, 'a worker run moves tasks');
  fill();
  target.dispatchEvent(new Event('pf:notifications-changed'));
  assert.equal(cache.get('w:/assignees/mine'), undefined, 'a notification may be a new assignment');
});

test('a workspace invite here or in another tab expires the cached members', () => {
  const target = new EventTarget();
  const cache = new ReadCache();
  cache.listen(target as unknown as Window);
  put(cache, 'w:/workspaces/w1/members', '/workspaces/w1/members', 1, 60_000);
  target.dispatchEvent(new Event('pf:workspace-invites-changed'));
  assert.equal(cache.get('w:/workspaces/w1/members'), undefined);
  put(cache, 'w:/workspaces/w1/members', '/workspaces/w1/members', 1, 60_000);
  const other = new Event('storage');
  Object.defineProperty(other, 'key', { value: 'pf:workspace-invites-changed' });
  target.dispatchEvent(other);
  assert.equal(cache.get('w:/workspaces/w1/members'), undefined);
});

test('an answer is stored by when it was asked for: never over a newer one, never across an own write', () => {
  const c = clock();
  const changes: number[] = [];
  const cache = new ReadCache(c.now, () => changes.push(c.now()));
  const policy = { fresh: 60_000, keep: 600_000 };
  const sent = c.now();
  c.advance(10);
  cache.afterWrite('/projects/p1/tasks/t1');
  assert.equal(changes.length, 1, 'reads in flight stop being shared');
  assert.equal(cache.store('w:/projects/p1/tasks', '/projects/p1/tasks', 'before the write', policy, null, sent), false);
  assert.equal(cache.store('w:/projects/p1/members', '/projects/p1/members', 'untouched', policy, null, sent), true);
  assert.equal(cache.changedSince('/assignees/mine', sent), 'dropped', 'a device copy saved before the write is not shown');
  assert.equal(cache.changedSince('/assignees/mine', c.now() + 1), null);

  const asked = c.now();
  c.advance(10);
  cache.expire((path) => path === '/projects/p1/site');
  assert.equal(cache.store('w:/projects/p1/site', '/projects/p1/site', 'maybe before the change', policy, null, asked), true);
  assert.equal(cache.get('w:/projects/p1/site'), undefined, 'stored, but already expired');
  assert.equal(cache.peek('w:/projects/p1/site'), 'maybe before the change');

  const later = c.now();
  assert.equal(cache.store('w:/inbox', '/inbox', 'new', policy, null, later), true);
  assert.equal(cache.store('w:/inbox', '/inbox', 'old', policy, null, later - 5), false, 'an older answer arriving late');
  assert.equal(cache.get('w:/inbox'), 'new');
});

test('own writes are remembered for the page, merged once there are many', () => {
  const c = clock();
  const cache = new ReadCache(c.now);
  const start = c.now();
  for (let i = 0; i < 70; i += 1) {
    c.advance(1);
    cache.afterWrite(`/projects/p${i}/views`);
  }
  assert.equal(cache.changedSince('/projects/p9/views', start), 'dropped');
  assert.equal(cache.changedSince('/me/ui-prefs', start), 'dropped', 'merged: stricter, never wrong');
  c.advance(1);
  assert.equal(cache.changedSince('/me/ui-prefs', c.now()), null);
});
