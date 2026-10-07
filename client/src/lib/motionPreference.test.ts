import assert from 'node:assert/strict';
import test from 'node:test';
import { motionEnabled } from './motionPreference.ts';
import { loadingLayoutForPath, projectLoadingLayout } from './loadingLayout.ts';

test('motion defaults on regardless of input device, respecting opt-out and OS', () => {
  assert.equal(motionEnabled(null, false), true);
  assert.equal(motionEnabled('on', false), true);
  assert.equal(motionEnabled('off', false), false);
  for (const preference of [null, 'on', 'off'])
    assert.equal(motionEnabled(preference, true), false);
});

test('deep links get a matching silhouette before their page chunk arrives', () => {
  for (const [path, layout] of Object.entries({
    '/': 'inbox',
    '/projects/p': 'board',
    '/projects/p/overview': 'overview',
    '/projects/p/tasks/t': 'task',
    '/projects/p/kb': 'document',
    '/projects/p/finance': 'dashboard',
    '/ai/c/a': 'chat',
    '/workspaces/w/settings': 'settings',
    '/profile': 'settings',
    '/invite/token': 'auth',
    '/p/public/t/t': 'task',
  }))
    assert.equal(loadingLayoutForPath(path), layout);
});

test('saved loading layouts are scoped to the project and tolerate invalid storage', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map([
    ['pf:board-view:p1', 'table-1'],
    [
      'pf:view-layouts:p1',
      JSON.stringify({ 'table-1': 'table', 'calendar-1': 'calendar' }),
    ],
    ['pf:view-layouts:p2', 'invalid JSON'],
  ]);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => values.get(key) ?? null },
  });
  try {
    assert.equal(projectLoadingLayout('p1'), 'table');
    assert.equal(projectLoadingLayout('p1', 'calendar-1'), 'calendar');
    assert.equal(projectLoadingLayout('p1', 'default'), 'board');
    assert.equal(projectLoadingLayout('p2', 'table-1'), 'board');
    assert.equal(projectLoadingLayout('p3', 'table-1'), 'board');
    values.set('pf:view-layouts:p1', 'null');
    assert.equal(projectLoadingLayout('p1'), 'board');
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
