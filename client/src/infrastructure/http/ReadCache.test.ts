import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadCache, readCacheTtl } from './ReadCache';

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
  for (const path of ['/projects/p1/tasks/t1', '/projects/p1/tasks/t1/comments', '/me/unread-tasks', '/me/shared-members', '/notifications/unread-count', '/projects/p1/live/activity', '/auth/me', '/platform/deployment', '/projects?archived=1']) {
    assert.equal(readCacheTtl(path), null, `${path} must always be read fresh`);
  }
});

test('an entry lives for its TTL and every reader gets its own copy', () => {
  const c = clock();
  const cache = new ReadCache(c.now);
  cache.set('w:/projects/p1/members', '/projects/p1/members', { members: [{ id: 'a' }] }, 1000);
  const first = cache.get('w:/projects/p1/members') as { members: Array<{ id: string }> };
  first.members.push({ id: 'mutated by a caller' });
  assert.deepEqual(cache.get('w:/projects/p1/members'), { members: [{ id: 'a' }] });
  c.advance(1001);
  assert.equal(cache.get('w:/projects/p1/members'), undefined);
});

test('a write clears everything, except the writes made while just browsing', () => {
  const cache = new ReadCache();
  const fill = (): void => {
    cache.set('w:/projects', '/projects', 1, 60_000);
    cache.set('w:/projects/p1/members', '/projects/p1/members', 2, 60_000);
    cache.set('w:/projects/p1/views', '/projects/p1/views', 3, 60_000);
    cache.set('w:/me/ui-prefs', '/me/ui-prefs', 4, 60_000);
  };
  fill();
  cache.afterWrite('/recent-task-views');
  assert.equal(cache.get('w:/projects'), 1, 'opening a task records a view: nothing to forget');
  cache.afterWrite('/projects/p1/views');
  assert.equal(cache.get('w:/projects/p1/views'), undefined, 'a board view write forgets the views list');
  assert.equal(cache.get('w:/projects/p1/members'), 2);
  cache.afterWrite('/me/ui-prefs');
  assert.equal(cache.get('w:/me/ui-prefs'), undefined);
  assert.equal(cache.get('w:/projects'), 1);
  fill();
  cache.afterWrite('/projects/p1/tasks/t1/move');
  for (const key of ['w:/projects', 'w:/projects/p1/members', 'w:/projects/p1/views', 'w:/me/ui-prefs']) {
    assert.equal(cache.get(key), undefined, `${key} after a real write`);
  }
});

test('realtime events and reconnects drop what they may have changed', () => {
  const target = new EventTarget();
  const cache = new ReadCache();
  cache.listen(target as unknown as Window);
  const fill = (): void => {
    cache.set('w:/projects', '/projects', 1, 60_000);
    cache.set('w:/projects/p1', '/projects/p1', 2, 60_000);
    cache.set('w:/projects/p1/members', '/projects/p1/members', 3, 60_000);
    cache.set('w:/projects/p1/site', '/projects/p1/site', 4, 60_000);
  };
  fill();
  target.dispatchEvent(new CustomEvent('pf:task-changed', { detail: { projectId: 'p1' } }));
  assert.equal(cache.get('w:/projects'), undefined, 'task counts in the project list');
  assert.equal(cache.get('w:/projects/p1'), undefined);
  assert.equal(cache.get('w:/projects/p1/members'), 3, 'members do not change with a task');
  target.dispatchEvent(new CustomEvent('pf:live-changed', { detail: { projectId: 'p1' } }));
  assert.equal(cache.get('w:/projects/p1/site'), undefined, 'a worker run may publish the site');
  fill();
  target.dispatchEvent(new CustomEvent('pf:project-changed', { detail: { projectId: 'p1' } }));
  assert.equal(cache.get('w:/projects/p1/members'), undefined);
  fill();
  target.dispatchEvent(new Event('pf:realtime-connected'));
  assert.equal(cache.get('w:/projects/p1/members'), undefined, 'events may have been missed while disconnected');
  fill();
  target.dispatchEvent(new Event('online'));
  assert.equal(cache.get('w:/projects'), undefined);
});

test('every invalidation moves the generation, so an in-flight read is not stored across it', () => {
  const cache = new ReadCache();
  const before = cache.generation;
  cache.afterWrite('/recent-task-views');
  assert.equal(cache.generation, before, 'nothing was invalidated');
  cache.afterWrite('/projects/p1/tasks');
  assert.ok(cache.generation > before);
});

test('a task changed anywhere drops the task lists at once', () => {
  const target = new EventTarget();
  const cache = new ReadCache();
  cache.listen(target as unknown as Window);
  const fill = (): void => {
    cache.set('w:/assignees/mine', '/assignees/mine', 1, 15_000);
    cache.set('w:/projects/p1/tasks', '/projects/p1/tasks', 2, 15_000);
    cache.set('w:/projects/p2/tasks', '/projects/p2/tasks', 3, 15_000);
    cache.set('w:/projects/p1/members', '/projects/p1/members', 4, 60_000);
  };
  fill();
  target.dispatchEvent(new CustomEvent('pf:task-changed', { detail: { projectId: 'p1' } }));
  assert.equal(cache.get('w:/assignees/mine'), undefined);
  assert.equal(cache.get('w:/projects/p1/tasks'), undefined);
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

test('a workspace invite here or in another tab drops the cached members', () => {
  const target = new EventTarget();
  const cache = new ReadCache();
  cache.listen(target as unknown as Window);
  cache.set('w:/workspaces/w1/members', '/workspaces/w1/members', 1, 60_000);
  target.dispatchEvent(new Event('pf:workspace-invites-changed'));
  assert.equal(cache.get('w:/workspaces/w1/members'), undefined);
  cache.set('w:/workspaces/w1/members', '/workspaces/w1/members', 1, 60_000);
  const other = new Event('storage');
  Object.defineProperty(other, 'key', { value: 'pf:workspace-invites-changed' });
  target.dispatchEvent(other);
  assert.equal(cache.get('w:/workspaces/w1/members'), undefined);
});
